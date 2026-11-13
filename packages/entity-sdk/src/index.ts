import { z } from 'zod';
import { commandEnvelopeSchema, type Command, type PublicWorld } from '../../contracts/src/index';

const responseSchema = z.json();

export type CommandResponse = z.infer<typeof responseSchema>;

/** Credentials belong to the entity runtime. Never embed this SDK token in site bundles. */
export class EntityClient {
  constructor(private readonly endpoint: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}
  async command(command: Command, idempotencyKey: string): Promise<CommandResponse> {
    const envelope = commandEnvelopeSchema.parse({ command, idempotencyKey });

    const response = await this.fetcher(new URL('/api/v1/commands', this.endpoint), {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(envelope),
    });

    if (!response.ok) throw new Error(`Entity command rejected (${response.status})`);

    return responseSchema.parse(await response.json());
  }
  async world(): Promise<PublicWorld> {
    const response = await this.fetcher(new URL('/api/v1/public', this.endpoint));

    if (!response.ok) throw new Error('World unavailable');

    return response.json();
  }
}
