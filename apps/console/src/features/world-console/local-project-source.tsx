import { useRef, useState } from 'react';
import { z } from 'zod';

const sourceSchema = z.object({ commit: z.string(), source: z.string() });

export function LocalProjectSource() {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  return <details className="local-project-source">
    <summary>Inspect generated HTML</summary>
    <button disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);

      try {
        const response = await fetch('/api/v1/local-glm/source');

        if (!response.ok) throw new Error('Source unavailable');
        const result = sourceSchema.parse(await response.json());
        setSource(`Commit ${result.commit}\n\n${result.source}`);
        setError('');
      } catch { setError('No generated HTML is available yet.'); } finally { pending.current = false; setBusy(false); }
    }}>Load current committed source</button>
    {error && <p role="alert">{error}</p>}
    {source && <pre>{source}</pre>}
  </details>;
}
