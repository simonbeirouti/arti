import { createExecutionContext } from 'cloudflare:test';
import { expect, it } from 'vitest';
import execution from '../../src/index';
import { ExecutionGateway } from '../cloud-build/gateway';
import { PublicationWorkflow, type BuildEnvironment } from '../cloud-build/workflow';

function closedEnvironment(): BuildEnvironment {
  // SAFETY: Deliberately unavailable bindings prove disabled entrypoints stop before any access.
  return new Proxy({ PUBLICATION_ENABLED: 'false' }, {
    get(target, key) {
      if (key === 'PUBLICATION_ENABLED') return target.PUBLICATION_ENABLED;
      throw new Error(`Unexpected binding access: ${String(key)}`);
    },
  }) as BuildEnvironment;
}

it('blocks workflow startup before acquiring leases, reserving allowance, or parsing event contents', async () => {
  // Only env may be read before the guard rejects; native context fields are deliberately absent.
  const workflow = { env: closedEnvironment() };
  // SAFETY: The disabled guard must run before event or step fields can be inspected.
  const event = {} as Parameters<PublicationWorkflow['run']>[0];
  // SAFETY: No workflow step implementation is available or needed when publication is disabled.
  const step = {} as Parameters<PublicationWorkflow['run']>[1];
  await expect(PublicationWorkflow.prototype.run.call(workflow, event, step)).rejects.toThrow('Entity publication disabled');
});

it('blocks rollback and build requests before even inspecting authoritative state', async () => {
  // SAFETY: Extra gateway resources intentionally remain unavailable under this closed configuration.
  const environment = closedEnvironment() as ConstructorParameters<typeof ExecutionGateway>[1];
  const gateway = new ExecutionGateway(createExecutionContext(), environment);
  await expect(gateway.rollback('builder-1', 'deployment')).rejects.toThrow('Entity publication disabled');
  await expect(gateway.bootstrapVisitorBaseline('c5190033-e240-4edf-b0e0-20623c9571fa')).rejects.toThrow('Entity publication disabled');
  await expect(gateway.execute('builder-1', 'execution.request_build', '{}')).rejects.toThrow('Entity publication disabled');
  await expect(gateway.execute('builder-1', 'repo.read', '{}')).rejects.toThrow('Unexpected binding access: WORLD');
  await expect(gateway.evaluateCode('evaluation', '', '')).rejects.toThrow('Unexpected binding access: EVALUATIONS_ENABLED');
});

it('blocks HTTP and queued push events, including dead letters, without writes or acknowledgements', async () => {
  // SAFETY: Index-specific bindings are also intentionally unavailable to prove early rejection.
  const environment = closedEnvironment() as Parameters<typeof execution.fetch>[1];
  const context = { ...createExecutionContext(), exports: { ApplicationDataConnector() { throw new Error('Disabled publication must not create an application connector'); } } };
  expect((await execution.fetch(new Request('https://builder.entities.invalid/'), environment, context)).status).toBe(503);

  for (const queue of ['arti-artifact-events', 'arti-artifact-events-dead']) {
    let acknowledged = false;
    // Batch parsing must never happen when publication is closed.
    const batch: Parameters<typeof execution.queue>[0] = { queue, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, retryAll() {}, ackAll() {}, messages: [{ id: 'disabled', timestamp: new Date(), attempts: 1, body: {}, retry() {}, ack() { acknowledged = true; } }] };
    await expect(execution.queue(batch, environment)).rejects.toThrow('Entity publication disabled');
    expect(acknowledged).toBe(false);
  }
});
