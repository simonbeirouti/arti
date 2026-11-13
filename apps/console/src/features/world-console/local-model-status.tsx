import { useRef, useState } from 'react';
import type { WorldState } from '../../../../../packages/contracts/src/index';

export function LocalModelStatus({ state, refresh }: { state: WorldState; refresh?: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const local = state.localInference;

  if (!local) return null;

  return <section className="panel" aria-label="Local GLM status">
    <h3>Real GLM agents · local website previews</h3>
    <p>Set your website target below, approve the public authoring brief, then start the goal. Follow conversations and open the project to watch the preview evolve. Review each acceptance criterion and accept the result when it is ready.</p>
    <p>{local.status} · ${state.budget.dailyUsd.toFixed(2)}/day · ${state.budget.spentUsd.toFixed(4)} used · ${state.budget.reservedUsd.toFixed(4)} reserved</p>
    <p className="muted">Code and structural checks stay local. They do not establish cloud verification or fulfil your criteria without your review.</p>
    {local.status === 'blocked' && <><p role="alert">{local.error}</p><button disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);

      try {
        const response = await fetch('/api/v1/local-glm/retry', { method: 'POST' });

        if (!response.ok) throw new Error('Unable to resume local agents');
        setError('');
        await refresh?.();
      } catch { setError('Unable to resume local agents. Check the local server.'); } finally { pending.current = false; setBusy(false); }
    }}>Resume local agents</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
