import { join } from 'node:path';
import type { Actor, Command, Deployment, Entity, WorldState } from '../packages/contracts/src/index';
import { WorldEngine } from '../packages/domain/src/index';
import { LocalExecution } from '../apps/execution/src/local';
import { LocalWorldStore } from './local-store';

/** Serializes local commands; failed simulation turns never replace canonical world state. */
export class ApiService {
  private engine: WorldEngine;
  private readonly store: LocalWorldStore;
  readonly execution: LocalExecution;
  private pending: Promise<void> = Promise.resolve();

  constructor(dataRoot: string, private readonly localAllowance?: number) {
    this.store = new LocalWorldStore(join(dataRoot, 'world.sqlite'));
    this.engine = new WorldEngine(this.store.load(), localAllowance !== undefined);
    this.execution = new LocalExecution(join(dataRoot, 'execution'), {
      localStatic: localAllowance !== undefined,
      now: () => this.engine.getState().clock,
      getProjects: () => this.engine.getState().projects ?? [],
      validatePublicText: text => this.engine.validatePublicText(text),
      validateGoal: (goalId, revision) => this.engine.getState().goals.some((goal) => goal.id === goalId && goal.revision === revision && goal.status === 'active'),
    });
  }

  async initialize(): Promise<void> {
    await this.execution.initialize(this.engine.getState().entities);

    const projects = this.engine.getState().projects ?? [];

    for (const project of projects) {
      for (const deployment of await this.execution.deployments(project.id)) {
        const current = this.engine.getState().projects?.find(item => item.id === project.id);

        if (deployment.version > (current?.siteVersion ?? 0)) this.engine.recordDeployment(deployment);
      }
    }

    if (!projects.length) for (const entity of this.engine.getState().entities) {
      const initial = (await this.execution.deployments(entity.id)).at(-1);

      if (initial && initial.version > entity.siteVersion) this.engine.recordDeployment(initial);
    }

    if (this.localAllowance !== undefined) this.engine.configureLocalInference(this.localAllowance);
    this.store.save(this.engine.getState());
  }

  getState(): WorldState {
    return this.engine.getState();
  }

  getPublicState() {
    return this.engine.getPublicState();
  }

  getPublicBuild() { return this.engine.getPublicBuild(); }
  visitor(id: string) { return this.engine.getState().visitorBuild?.visitors.find(visitor => visitor.id === id) ?? null; }
  visitorMutation<T>(run: (candidate: WorldEngine) => T): Promise<T> {
    const operation = this.pending.then(() => {
      const candidate = new WorldEngine(this.engine.getState(), this.localAllowance !== undefined);
      const result = run(candidate);
      this.store.save(candidate.getState());
      this.engine = candidate;

      return result;
    });

    this.pending = operation.then(() => {}, () => {});

    return operation;
  }

  command(actor: Actor, command: Command, key: string): Promise<WorldState> {
    const operation = this.pending.then(async () => {
      const before = this.engine.getState();
      const candidate = new WorldEngine(before, this.localAllowance !== undefined);

      if (command.type === 'world.tick' && !before.processedCommands[key]) candidate.advanceVisitorSimulation();
      candidate.dispatch(actor, command, key);

      if (command.type === 'world.tick' && !before.processedCommands[key]) {
        const after = candidate.getState();

        for (const task of after.tasks) {
          const previous = before.tasks.find((item) => item.id === task.id);

          if (task.status !== 'verified' || previous?.status === 'verified') continue;

          const entity = after.entities.find((item) => item.id === task.entityId);

          if (!entity) throw new Error('Task references an absent entity');

          const deployment = await this.execution.publish(entity, { projectId: task.projectId, goalId: task.goalId, revision: task.revision, taskId: task.id });
          candidate.recordDeployment(deployment);
          candidate.replaceEvidenceSource(task.id, deployment.commit, deployment.id);
        }
      }

      this.store.save(candidate.getState());
      this.engine = candidate;

      return this.engine.getState();
    });

    this.pending = operation.then(() => {}, () => {});

    return operation;
  }

  /** Serialize trusted local runtime writes with operator commands. */
  localMutation<T>(run: (candidate: WorldEngine) => T | Promise<T>): Promise<T> {
    if (this.localAllowance === undefined) return Promise.reject(new Error('Local inference disabled'));

    const operation = this.pending.then(async () => {
      const candidate = new WorldEngine(this.engine.getState(), true);
      candidate.localStatus('working');
      const result = await run(candidate);
      this.store.save(candidate.getState());
      this.engine = candidate;

      return result;
    });

    this.pending = operation.then(() => {}, () => {});

    return operation;
  }

  close(): void {
    this.store.close();
  }

  publishEntity(actor: Actor, publish: (entities: Entity[]) => Promise<Deployment>): Promise<Deployment> {
    const operation = this.pending.then(async () => {
      const candidate = new WorldEngine(this.engine.getState(), this.localAllowance !== undefined);
      const state = candidate.getState();

      if (actor.role !== 'entity' || !state.entities.some(entity => entity.id === actor.entityId)) throw new Error('Authenticated entity required');

      if (state.paused) throw new Error('World is paused');

      if (state.mode !== 'simulation') throw new Error('Local publication is simulation only');
      const deployment = await publish(state.entities);

      if (deployment.entityId !== actor.entityId) throw new Error('Deployment does not belong to authenticated entity');
      candidate.recordDeployment(deployment);
      this.store.save(candidate.getState());
      this.engine = candidate;

      return deployment;
    });

    this.pending = operation.then(() => {}, () => {});

    return operation;
  }

  recordDeployment(deployment: Deployment): Promise<void> {
    const operation = this.pending.then(() => {
      const candidate = new WorldEngine(this.engine.getState(), this.localAllowance !== undefined);
      candidate.recordDeployment(deployment);
      this.store.save(candidate.getState());
      this.engine = candidate;
    });

    this.pending = operation.then(() => {}, () => {});

    return operation;
  }
}
