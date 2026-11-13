import { retainedApplicationExport } from '../backup-export/integrity';
import { DurableObject, RpcTarget } from 'cloudflare:workers';
import { z } from 'zod';

const keySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/);

/** No entity parameter is exposed to generated code. The dispatcher selects this object. */
export interface ApplicationDataApi {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type DataEnvironment = { BUILDS: R2Bucket; WORLD: { getByName(name: string): { applicationWritesAllowed(): Promise<boolean>; authorizeBackupExport(entityId: string, backupId: string, reserveDispatch: boolean): Promise<void> } } };

export const applicationSnapshotSchema = z.array(z.tuple([z.string().regex(/^(app:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}|job:[a-zA-Z0-9_.:-]{1,220})$/), z.union([z.string().max(32_000), z.number().finite()])])).max(25_000).superRefine((entries, ctx) => {
  const keys = new Set<string>();
  let appCount = 0;
  let bytes = 0;

  for (const [key, value] of entries) {
    if (keys.has(key) || (key.startsWith('app:') && !z.string().safeParse(value).success) || (key.startsWith('job:') && !z.number().safeParse(value).success)) ctx.addIssue({ code: 'custom', message: 'Invalid or duplicate application backup record' });
    keys.add(key);

    if (key.startsWith('app:')) { appCount++; bytes += new TextEncoder().encode(JSON.stringify([key, value])).byteLength; }
  }

  if (appCount > 1000 || bytes > 1_000_000) ctx.addIssue({ code: 'custom', message: 'Application backup exceeds quota' });
});

export class ApplicationStore extends DurableObject<DataEnvironment> {
  private async writesAllowed(): Promise<void> {
    if (!await this.env.WORLD.getByName('arti-world').applicationWritesAllowed()) throw new Error('Application writes paused');
  }
  async exportSnapshot(entityId: string, backupId: string): Promise<{ key: string; sha256: string }> {
    await this.env.WORLD.getByName('arti-world').authorizeBackupExport(entityId, backupId, false);
    await this.ctx.storage.put('frozen', true);
    const key = `app-backups/${backupId}/${entityId}.json`;
    const validate = (text: string): void => { applicationSnapshotSchema.parse(JSON.parse(text)); };

    const retained = await retainedApplicationExport(this.env.BUILDS, key, validate);

    if (retained) return retained;
    await this.env.WORLD.getByName('arti-world').authorizeBackupExport(entityId, backupId, true);
    const entries = await this.ctx.storage.list<string | number>();
    const data: [string, string | number][] = [];

    for (const [key, value] of entries) if (key.startsWith('app:') || key.startsWith('job:')) data.push([key, value]);
    const text = JSON.stringify(applicationSnapshotSchema.parse(data));
    await this.env.BUILDS.put(key, text, { onlyIf: { etagDoesNotMatch: '*' } });
    const receipt = await retainedApplicationExport(this.env.BUILDS, key, validate);

    if (!receipt) throw new Error('Application export persistence missing');

    return receipt;
  }
  async restoreSnapshot(key: string, sha256: string): Promise<void> {
    const stored = await this.env.BUILDS.get(key);

    if (!stored || stored.size > 40_000_000) throw new Error('Application backup unavailable or too large');
    const text = await stored.text();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

    if (digest !== sha256) throw new Error('Application backup checksum mismatch');
    const snapshot = applicationSnapshotSchema.parse(JSON.parse(text));
    await this.ctx.storage.transaction(async storage => {
      const old = await storage.list();
      await storage.delete([...old.keys()]);
      await storage.put('frozen', true);

      for (const [key, value] of snapshot) await storage.put(key, value);
    });
  }
  async releaseFreeze(): Promise<void> {
    await this.writesAllowed();
    await this.ctx.storage.delete('frozen');
  }
  async get(key: string): Promise<string | null> {
    return await this.ctx.storage.get<string>(`app:${keySchema.parse(key)}`) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    z.string().max(32_000).parse(value);
    await this.writesAllowed();
    const storageKey = `app:${keySchema.parse(key)}`;
    await this.ctx.storage.transaction(async storage => {
      if (await storage.get('frozen')) throw new Error('Application backup freeze active');
      const entries = await storage.list<string>({ prefix: 'app:', limit: 1001 });

      if (!entries.has(storageKey) && entries.size >= 1000) throw new Error('Application record quota exhausted');
      let size = new TextEncoder().encode(JSON.stringify([storageKey, value])).byteLength;

      for (const [key, stored] of entries) if (key !== storageKey) size += new TextEncoder().encode(JSON.stringify([key, stored])).byteLength;

      if (size > 1_000_000) throw new Error('Application byte quota exhausted');
      await storage.put(storageKey, value);
    });
  }
  async delete(key: string): Promise<void> {
    await this.writesAllowed();
    await this.ctx.storage.transaction(async storage => {
      if (await storage.get('frozen')) throw new Error('Application backup freeze active');
      await storage.delete(`app:${keySchema.parse(key)}`);
    });
  }
  async claimJob(key: string): Promise<boolean> {
    const parsed = z.string().regex(/^[a-zA-Z0-9_.:-]{1,220}$/).parse(key);

    return this.ctx.storage.transaction(async storage => {
      if (await storage.get('frozen')) throw new Error('Application backup freeze active');

      if (await storage.get(`job:${parsed}`)) return false;
      const prior = await storage.list<number>({ prefix: 'job:', limit: 1000 });
      const expired: string[] = [];

      for (const [key, time] of prior) if (time < Date.now() - 7 * 86_400_000) expired.push(key);

      if (expired.length) await storage.delete(expired);
      await storage.put(`job:${parsed}`, Date.now());

      return true;
    });
  }
}

/** RpcTarget hides the underlying namespace and does not expose scheduler methods. */
export class ScopedApplicationData extends RpcTarget implements ApplicationDataApi {
  #store: ApplicationDataApi;
  constructor(store: ApplicationDataApi) { super(); this.#store = store; }
  async get(key: string): Promise<string | null> { return this.#store.get(keySchema.parse(key)); }
  async put(key: string, value: string): Promise<void> { return this.#store.put(keySchema.parse(key), z.string().max(32_000).parse(value)); }
  async delete(key: string): Promise<void> { return this.#store.delete(keySchema.parse(key)); }
}
