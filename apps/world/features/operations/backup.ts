import type { WorldState } from '../../../../packages/contracts/src/index';
import { z } from 'zod';
import { parseWorldState } from '../../../../packages/domain/src/index';
import { privateSnapshotSchema } from '../../../agent-runtime/features/memory/state';

export const repositoryExportSchema = z.object({ entityId: z.string(), key: z.string().regex(/^git-backups\//), commit: z.string().regex(/^[a-f0-9]{40}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) });

export const applicationExportSchema = z.object({ entityId: z.string(), key: z.string().regex(/^app-backups\//), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export const backupProgressSchema = z.object({
  exportScope: z.enum(['entities', 'projects']).optional(), schemaVersion: z.literal(1), id: z.string().regex(/^\d+$/), environment: z.string().min(1), createdAt: z.string().datetime(), mode: z.enum(['simulation', 'live']), entityIds: z.array(z.string()).min(1),
  rows: z.array(z.object({ entityId: z.string(), memory: z.object({ payload: privateSnapshotSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), repository: repositoryExportSchema.optional(), application: applicationExportSchema.optional() }).strict()),
}).strict();

export const backupCheckpointSchema = backupProgressSchema.omit({ rows: true }).extend({ rows: z.array(z.object({ entityId: z.string(), key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()) }).strict();

export type BackupCheckpoint = z.infer<typeof backupCheckpointSchema>;

export type BackupProgress = z.infer<typeof backupProgressSchema>;

export type BackupProgressContext = { id: string; environment: string; mode: 'simulation' | 'live'; exportScope?: 'entities' | 'projects'; entityIds: string[] };

function validateBackupScope(progress: BackupProgress | BackupCheckpoint, context: BackupProgressContext): void {
  if (progress.id !== context.id || progress.environment !== context.environment || progress.mode !== context.mode || (progress.exportScope ?? 'entities') !== (context.exportScope ?? 'entities') || progress.createdAt !== new Date(Number(context.id)).toISOString() || JSON.stringify(progress.entityIds) !== JSON.stringify(context.entityIds) || JSON.stringify(progress.rows.map(row => row.entityId)) !== JSON.stringify(context.entityIds.slice(0, progress.rows.length))) throw new Error('Backup checkpoint scope or population mismatch');

  if (progress.rows.length > context.entityIds.length || new Set(progress.entityIds).size !== progress.entityIds.length) throw new Error('Backup checkpoint duplicate population');

}

export function validateBackupCheckpoint(input: BackupCheckpoint, context: BackupProgressContext): BackupCheckpoint {
  const checkpoint = backupCheckpointSchema.parse(input);
  validateBackupScope(checkpoint, context);

  for (const row of checkpoint.rows) if (row.key !== `progress/${context.id}/${row.entityId}.json`) throw new Error('Backup checkpoint object key mismatch');

  return checkpoint;
}

/** Only complete ordered rows from this paused backup may be resumed. */
export async function validateBackupProgress(input: BackupProgress, context: BackupProgressContext): Promise<BackupProgress> {
  const progress = backupProgressSchema.parse(input);

  validateBackupScope(progress, context);

  for (const row of progress.rows) {
    if (row.memory.payload.entityId !== row.entityId || await digest(JSON.stringify(row.memory.payload)) !== row.memory.sha256) throw new Error('Backup checkpoint private memory mismatch');

    if (context.mode === 'live' && context.exportScope !== 'projects' && (!row.repository || !row.application)) throw new Error('Incomplete backup checkpoint entity');

    if (row.repository && (row.repository.entityId !== row.entityId || row.repository.key !== `git-backups/${context.id}/${row.entityId}.bundle`) || row.application && (row.application.entityId !== row.entityId || row.application.key !== `app-backups/${context.id}/${row.entityId}.json`)) throw new Error('Backup checkpoint export identity or key mismatch');
  }

  return progress;
}

export const backupSchema = z.object({
  schemaVersion: z.literal(2), id: z.string(), environment: z.string().min(1), createdAt: z.string().datetime(),
  world: z.string().transform(value => parseWorldState(value)),
  entities: z.array(z.object({ payload: privateSnapshotSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  repositories: z.array(repositoryExportSchema),
  applicationData: z.array(z.object({ entityId: z.string(), key: z.string().regex(/^app-backups\//), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).default([]),
});

export async function digestBytes(input: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function digest(input: string): Promise<string> { return digestBytes(new TextEncoder().encode(input).buffer); }

export function backupExportTargets(state: WorldState): string[] { return state.projects?.length ? state.projects.flatMap(project => project.siteVersion > 0 ? [project.id] : []) : state.entities.map(entity => entity.id); }

export async function validateCompleteBackup(input: string, environment: string): Promise<z.infer<typeof backupSchema>> {
  const backup = backupSchema.parse(JSON.parse(input));

  if (backup.environment !== environment || !backup.world.paused) throw new Error('Backup environment mismatch or unfrozen state');
  const expected = backup.world.entities.map(entity => entity.id).sort();

  if (JSON.stringify(backup.entities.map(entity => entity.payload.entityId).sort()) !== JSON.stringify(expected)) throw new Error('Incomplete or duplicate private memory population');

  const expectedExports = backupExportTargets(backup.world).sort();

  if (backup.world.mode === 'live' && JSON.stringify(backup.repositories.map(repo => repo.entityId).sort()) !== JSON.stringify(expectedExports)) throw new Error('Incomplete Git export population');

  if (backup.world.mode === 'live' && JSON.stringify(backup.applicationData.map(item => item.entityId).sort()) !== JSON.stringify(expectedExports)) throw new Error('Incomplete application data population');

  for (const entity of backup.entities) if (await digest(JSON.stringify(entity.payload)) !== entity.sha256) throw new Error('Private memory checksum mismatch');

  return backup;
}
