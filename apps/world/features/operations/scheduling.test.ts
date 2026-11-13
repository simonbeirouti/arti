import { expect, it } from 'vitest';
import { liveTurnDue, liveCandidateWindow, scheduledAction, type RecoveryStatus } from './scheduling';

const now = Date.parse('2026-10-13T00:00:00Z');

const recent = { id: 'builder-1', lastActiveAt: new Date(now - 60000).toISOString() };

const idle: RecoveryStatus = { running: false, leaseExpired: true, pending: false, blocked: false };

it('routes idle residents to shared suggestions and prioritizes assignments and saved code continuations', () => {
  expect(scheduledAction(idle, false)).toBe('conversation');
  expect(scheduledAction(idle, true)).toBe('work');
  expect(scheduledAction({ ...idle, pending: true }, false)).toBe('work');
  expect(scheduledAction({ ...idle, pending: true, conversationPending: true }, false)).toBe('conversation');
  expect(scheduledAction({ ...idle, pending: true, conversationPending: true }, true)).toBe('work');
});

it('continues a safe pending personal slice next minute without restarting the thirty-minute cadence', () => {
  expect(liveTurnDue(recent, idle, false, false, now)).toBe(false);
  expect(liveTurnDue(recent, { ...idle, pending: true }, false, false, now)).toBe(true);
  expect(liveTurnDue(recent, idle, false, false, now + 30 * 60000)).toBe(true);
});

it('does not dispatch ambiguous effects or overlap an active lease, even for assigned work', () => {
  expect(liveTurnDue(recent, { ...idle, pending: true, blocked: true }, true, false, now)).toBe(false);
  expect(liveTurnDue(recent, { ...idle, pending: true, running: true, leaseExpired: false }, true, false, now)).toBe(false);
  expect(liveTurnDue(recent, { ...idle, pending: true, running: true }, true, false, now)).toBe(true);
});

it('retains shared-goal priority and never uses pending personal work to bypass it', () => {
  expect(liveTurnDue(recent, { ...idle, pending: true }, false, true, now)).toBe(false);
  expect(liveTurnDue(recent, idle, true, true, now)).toBe(true);
  expect(liveTurnDue({ id: 'researcher' }, idle, false, true, now)).toBe(false);
});


it('bounds setup/status RPC pairs to two and fairly rotates all residents across cron invocations', () => {
  const entities = Array.from({ length: 6 }, (_, index) => ({ id: `entity-${index}` }));
  const seen = new Set<string>();

  for (let minute = 0; minute < 6; minute += 1) {
    const window = liveCandidateWindow(entities, new Set(), false, now + minute * 60000);
    expect(window).toHaveLength(2);
    seen.add(window[0].id);
  }

  expect([...seen].sort()).toEqual(entities.map(entity => entity.id));
  expect(liveCandidateWindow(entities, new Set(['entity-2']), true, now)).toEqual([entities[2]]);
  expect(liveCandidateWindow(entities, new Set(), true, now)).toEqual([]);
});
