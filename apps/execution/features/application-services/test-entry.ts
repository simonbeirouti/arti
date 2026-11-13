import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import type { ApplicationDataApi } from './data';
import type { ApplicationConnectorContext } from './connector';

export { ApplicationDataConnector } from './connector';

export { ApplicationStore } from './data';

export class WriteAuthority extends DurableObject {
  applicationWritesAllowed(): boolean { return true; }
  async authorizeBackupExport(_entityId: string, _backupId: string, reserveDispatch: boolean): Promise<void> {
    if (reserveDispatch) await this.ctx.storage.put('exports', (await this.ctx.storage.get<number>('exports') ?? 0) + 1);
  }
  async exports(): Promise<number> { return await this.ctx.storage.get<number>('exports') ?? 0; }
}

export class DataConsumer extends WorkerEntrypoint<never, { APP_DATA: ApplicationDataApi }> {
  async fetch(): Promise<Response> {
    await this.ctx.props.APP_DATA.put('connector-probe', 'persisted');

    return Response.json({ value: await this.ctx.props.APP_DATA.get('connector-probe') });
  }
}

type FixtureContext = ApplicationConnectorContext & { exports: { DataConsumer(options: { props: { APP_DATA: ApplicationDataApi } }): { fetch(request: Request): Promise<Response> } } };

export default {
  async fetch(request: Request, _env: never, ctx: FixtureContext): Promise<Response> {
    const connector = ctx.exports.ApplicationDataConnector({ props: { entityId: 'connector-first' } });

    return ctx.exports.DataConsumer({ props: { APP_DATA: connector } }).fetch(request);
  },
};
