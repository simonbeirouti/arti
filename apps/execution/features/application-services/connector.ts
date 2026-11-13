import { WorkerEntrypoint } from 'cloudflare:workers';
import { z } from 'zod';
import { ScopedApplicationData, type ApplicationDataApi, type ApplicationStore } from './data';

interface ConnectorEnvironment { APP_DATA: DurableObjectNamespace<ApplicationStore> }

interface ConnectorProps { entityId: string }

export interface ApplicationConnectorContext extends ExecutionContext {
  exports: ExecutionContext['exports'] & {
    ApplicationDataConnector(options: { props: ConnectorProps }): ApplicationDataApi;
  };
}

/** A loopback service binding is serializable in dispatch props; its entity scope stays server-owned. */
export class ApplicationDataConnector extends WorkerEntrypoint<ConnectorEnvironment, ConnectorProps> implements ApplicationDataApi {
  #scoped(): ApplicationDataApi {
    const entityId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).parse(this.ctx.props.entityId);

    return new ScopedApplicationData(this.env.APP_DATA.getByName(entityId));
  }
  async get(key: string): Promise<string | null> { return this.#scoped().get(key); }
  async put(key: string, value: string): Promise<void> { await this.#scoped().put(key, value); }
  async delete(key: string): Promise<void> { await this.#scoped().delete(key); }
}
