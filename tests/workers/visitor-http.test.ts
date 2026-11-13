/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { VisitorSessionLedger } from '../../apps/world/features/visitor-http/sessions';

it('persists hashed sessions and expires them while bounding per-IP and aggregate intake', async () => {
  await runInDurableObject(env.WORLD.getByName('visitor-session-ledger'), async (_world, state) => {
    const ledger = new VisitorSessionLedger(state.storage.sql);
    ledger.put({ hash: 'hash-only', visitorId: 'visitor-server', expires: Date.now() + 100000 });
    expect(new VisitorSessionLedger(state.storage.sql).get('hash-only')?.visitorId).toBe('visitor-server');
    ledger.put({ hash: 'expired', visitorId: 'old-visitor', expires: 1 });
    expect(ledger.get('expired')).toBeUndefined();
    const now = Date.now();

    for (let index = 0; index < 10; index++) ledger.intake('ip-a', now);
    expect(() => ledger.intake('ip-a', now)).toThrow('limit');

    for (let index = 0; index < 90; index++) ledger.intake(`ip-${index}`, now);
    expect(() => ledger.intake('new-ip', now)).toThrow('limit');
    expect(() => ledger.intake('ip-a', now + 600001)).not.toThrow();
  });
});

it('canonical visitor identity survives RPC boundaries and submission retries do not duplicate work', async () => {
  const world = env.WORLD.getByName('visitor-endpoint-authority');
  const visitor = await world.onboardVisitor('hashed-cookie', 'Avery', 'ip-hash');
  expect(await world.visitorSession('hashed-cookie')).toEqual(visitor);
  expect(await world.visitorSession('forged-cookie')).toBeNull();
  const first = await world.submitVisitorSuggestion('hashed-cookie', 'Build a useful public calendar', 'request-visitor-1', 'ip-hash');
  const repeated = await world.submitVisitorSuggestion('hashed-cookie', 'Build a useful public calendar', 'request-visitor-1', 'ip-hash');
  expect(first.id).toBe(repeated.id);
  await runInDurableObject(world, async instance => {
    expect(() => instance.submitVisitorSuggestion('forged-cookie', 'Build a useful public calendar', 'request-forged-1', 'ip-hash')).toThrow('session');
  });
  expect(JSON.stringify(await world.publicBuild())).not.toContain('hashed-cookie');
  expect(JSON.stringify(await world.publicBuild())).not.toContain('ip-hash');
});
