interface RetainedObject { size: number; arrayBuffer(): Promise<ArrayBuffer> }

export interface ExportBucket {
  get(key: string): Promise<RetainedObject | null>;
}

async function readBounded(bucket: ExportBucket, key: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const object = await bucket.get(key);

  if (!object) return null;

  if (object.size > maxBytes) throw new Error('Retained export exceeds size bound');
  const bytes = new Uint8Array(await object.arrayBuffer());

  if (bytes.byteLength > maxBytes) throw new Error('Retained export exceeds size bound');

  return bytes;
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The backup transport emits complete SHA-1 bundles; restore independently verifies Git objects. */
export function bundleMainCommit(bytes: Uint8Array): string {
  const prefix = new TextDecoder().decode(bytes.slice(0, 16_384));
  const boundary = prefix.indexOf('\n\n');

  if (boundary === -1 || !prefix.startsWith('# v2 git bundle\n')) throw new Error('Invalid retained Git bundle header');
  const lines = prefix.slice(0, boundary).split('\n').slice(1);
  const main = lines.filter(line => /^[a-f0-9]{40} refs\/heads\/main$/.test(line));

  if (main.length !== 1 || lines.some(line => !/^[a-f0-9]{40} [^\s]+$/.test(line)) || prefix.slice(boundary + 2, boundary + 6) !== 'PACK') throw new Error('Invalid complete Git bundle refs');

  const [head] = main;

  if (!head) throw new Error('Missing retained main ref');

  return head.slice(0, 40);
}

export async function retainedGitExport(bucket: ExportBucket, key: string): Promise<{ key: string; commit: string; sha256: string } | null> {
  const bytes = await readBounded(bucket, key, 600_000);

  if (!bytes) return null;

  return { key, commit: bundleMainCommit(bytes), sha256: await digest(bytes) };
}

export async function retainedApplicationExport(bucket: ExportBucket, key: string, validate: (text: string) => void): Promise<{ key: string; sha256: string } | null> {
  const bytes = await readBounded(bucket, key, 40_000_000);

  if (!bytes) return null;
  validate(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

  return { key, sha256: await digest(bytes) };
}
