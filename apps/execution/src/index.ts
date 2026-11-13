import { publicationEnabled, requirePublication } from '../features/publication/gate';
/// <reference types="@cloudflare/workers-types" />
import { ApplicationStore } from '../features/application-services/data';
import type { ApplicationConnectorContext } from '../features/application-services/connector';
import { runScheduledJobs } from '../features/application-services/schedule';
import { z } from 'zod';
import { approvedAuthoringScope } from '../features/cloud-build/authoring-scope';
import { codeScope } from '../features/cloud-build/code-scope';
import { dispatch } from '../features/publication/dispatch';
import { buildRequestSchema, type BuildEnvironment, type BuildRequest } from '../features/cloud-build/workflow';

export { BuildSandbox } from '../features/cloud-build/sandbox';

export { PublicationWorkflow } from '../features/cloud-build/workflow';

const artifactEventSchema = z.object({ type: z.literal('cf.artifacts.repo.pushed'), source: z.object({ namespace: z.string(), repoName: z.string() }), payload: z.object({ ref: z.literal('refs/heads/main'), after: z.string().regex(/^[a-f0-9]{40}$/) }) });

type Environment = BuildEnvironment & { DISPATCH: DispatchNamespace; ENTITY_DOMAIN: string; SHOWCASE_HOSTNAME?: string; ARTIFACTS_NAMESPACE: string; PUBLICATION: Workflow<BuildRequest>; APP_DATA: DurableObjectNamespace<ApplicationStore> };

export default {
  async fetch(request: Request, environment: Environment, context: ApplicationConnectorContext): Promise<Response> {
    if (!publicationEnabled(environment)) return new Response('Entity publication disabled', { status: 503 });
    const started = Date.now();
    const response = await dispatch(request, environment, entityId => context.exports.ApplicationDataConnector({ props: { entityId } }));
    const entityId = new URL(request.url).hostname.replace(`.${environment.ENTITY_DOMAIN}`, '');

    if (/^[a-z0-9][a-z0-9_-]{0,79}$/.test(entityId)) context.waitUntil(environment.WORLD.getByName('arti-world').recordTraffic(entityId, 'unclassified', response.status, Date.now() - started, crypto.randomUUID()).catch(() => { console.warn('Traffic observation unavailable'); }));

    return response;
  },
  async scheduled(controller: ScheduledController, environment: Environment, context: ApplicationConnectorContext): Promise<void> {
    await runScheduledJobs(environment, controller.scheduledTime, entityId => context.exports.ApplicationDataConnector({ props: { entityId } }), entityId => environment.APP_DATA.getByName(entityId));
  },
  async queue(batch: MessageBatch, environment: Environment): Promise<void> {
    requirePublication(environment);

    if (batch.queue.endsWith('-dead')) {
      for (const message of batch.messages) {
        const body = JSON.stringify(message.body);
        await environment.BUILDS.put(`private-dead-letters/${crypto.randomUUID()}.json`, JSON.stringify({ queue: batch.queue, receivedAt: new Date().toISOString(), body: body.length <= 100_000 ? body : 'Oversized event omitted' }));
        await environment.WORLD.getByName('arti-world').noteOperation('execution.dead_letters');
        message.ack();
      }

      return;
    }

    if (environment.LIVE_ACTIVATED !== 'true' || !(Number(environment.DAILY_ALLOWANCE_USD) > 0)) throw new Error('Live publication disabled');

    for (const message of batch.messages) {
      const event = artifactEventSchema.parse(message.body);

      if (event.source.namespace !== environment.ARTIFACTS_NAMESPACE) throw new Error('Unregistered Artifacts namespace');
      const state = await environment.WORLD.getByName('arti-world').inspect();

      // Canonical promotion pushes are outputs of checked task workflows, never a new build actor.
      // Acknowledge only an exact world-registered shared repository after event and namespace validation.
      if (state.projects?.some(project => project.repository === event.source.repoName)) { message.ack(); continue; }

      const task = state.tasks.find((task) => {
        const project = state.projects?.find(project => project.id === task.projectId);

        return `${project ? `${project.repository}-` : ''}${task.entityId}-${task.id}` === event.source.repoName;
      });

      const entity = state.entities.find((entity) => entity.id === (task?.entityId ?? event.source.repoName) || event.source.repoName.startsWith(`${entity.id}-personal-`));

      if (!entity) throw new Error('Unregistered entity repository');

      if (state.deployments.some(deployment => deployment.entityId === entity.id && deployment.projectId === task?.projectId && deployment.commit === event.payload.after)) { message.ack(); continue; }

      const personalId = event.source.repoName.startsWith(`${entity.id}-personal-`) ? event.source.repoName.slice(entity.id.length + 1) : `personal-${event.payload.after}`;
      const scope = codeScope(state, entity.id, task?.id ?? personalId);
      const request: BuildRequest = { entityId: entity.id, repoName: event.source.repoName, commit: event.payload.after, taskId: scope.taskId };

        if (scope.projectId) request.projectId = scope.projectId;

      if (task) { request.goalId = task.goalId; request.revision = task.revision; request.authoringScope = approvedAuthoringScope(state, entity.id, task.id); }

      buildRequestSchema.parse(request);
      const id = `${scope.projectId ? `${scope.projectId}-` : ''}${entity.id}-${event.payload.after}`;

      try { await environment.PUBLICATION.create({ id, params: request }); } catch (error) {
        // Only acknowledge a duplicate if the deterministic workflow instance exists.
        try { await environment.PUBLICATION.get(id); } catch { throw error; }
      }

      message.ack();
    }
  },
};

export { ExecutionGateway } from '../features/cloud-build/gateway';

export { ApplicationStore };

export { ApplicationDataConnector } from '../features/application-services/connector';
