import { expect, it, vi } from 'vitest';
import { deliverOperationsAlert } from './alerts';

const alert = { type: 'arti.operations' as const, environment: 'staging', blockedTasks: 1, projectionLag: 2, pendingProjection: 1, failures: 0 };

it('does not send without explicit delivery authorization and allowlisted destination', async () => {
  const send = vi.fn();
  expect(await deliverOperationsAlert({ enabled: true, deliveryAuthorized: false, url: 'https://alerts.example/hook', allowedHost: 'alerts.example' }, alert, send)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it('sends bounded counter-only payload to configured destination and refuses redirects', async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  expect(await deliverOperationsAlert({ enabled: true, deliveryAuthorized: true, url: 'https://alerts.example/hook', allowedHost: 'alerts.example' }, alert, send)).toBe(true);
  expect(send.mock.calls[0][1].redirect).toBe('error');
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(alert);
  await expect(deliverOperationsAlert({ enabled: true, deliveryAuthorized: true, url: 'https://unapproved.example/', allowedHost: 'alerts.example' }, alert, send)).rejects.toThrow('scope');
});
