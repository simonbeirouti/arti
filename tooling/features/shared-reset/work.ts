import { privateSnapshotSchema, type PrivateSnapshot } from '../../../apps/agent-runtime/features/memory/state';
import { z } from 'zod';

export type ResetEntityArchive = { entityId: string; key: string; sha256: string };

export interface ResetWorkDependencies {
  authorize(resetId: string, entityId: string): Promise<void>;
  read(key: string): Promise<{ text: string; sha256: string; resetId: string; entityId: string } | null>;
  create(key: string, text: string, metadata: { sha256: string; resetId: string; entityId: string }): Promise<void>;
  export(): Promise<PrivateSnapshot>;
  import(snapshot: PrivateSnapshot): Promise<void>;
}

async function digest(text: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join(''); }

/** Preserve private memory, archive obsolete delivery state, then clear only operational work. */
export async function archiveAndClearSharedWork(resetId: string, entityId: string, dependencies: ResetWorkDependencies): Promise<ResetEntityArchive> {
  z.uuid().parse(resetId);
  z.string().regex(/^[a-z0-9-]{1,80}$/).parse(entityId);
  await dependencies.authorize(resetId, entityId);
  const key = `private-shared-resets/${resetId}/entities/${entityId}.json`;
  let saved = await dependencies.read(key);

  if (!saved) {
    const snapshot = privateSnapshotSchema.parse(await dependencies.export());

    if (snapshot.entityId !== entityId) throw new Error('Reset archive entity mismatch');
    const text = JSON.stringify(snapshot);

    if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error('Reset entity archive exceeds limit');
    await dependencies.create(key, text, { sha256: await digest(text), resetId, entityId });
    saved = await dependencies.read(key);
  }

  if (!saved || saved.resetId !== resetId || saved.entityId !== entityId || !/^[a-f0-9]{64}$/.test(saved.sha256) || await digest(saved.text) !== saved.sha256) throw new Error('Verified private entity archive required');
  const snapshot = privateSnapshotSchema.parse(JSON.parse(saved.text));

  if (snapshot.entityId !== entityId) throw new Error('Saved reset entity mismatch');
  await dependencies.authorize(resetId, entityId);
  await dependencies.import({ ...snapshot, state: { ...snapshot.state, running: false, leaseUntil: 0, turnId: null, checkpoint: 0, continuation: null, pendingCommand: null, governancePending: null } });

  return { entityId, key, sha256: saved.sha256 };
}
