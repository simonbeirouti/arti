import { useEffect, useState } from 'react';
import type { PublicBuild } from '../../../../../packages/contracts/src/visitor-build';
import { getBuild } from './client';

export function usePublicBuild() {
  const [build, setBuild] = useState<PublicBuild | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let pending = false;

    const refresh = async () => {
      if (pending) return;

      pending = true;

      try {
        const next = await getBuild();

        if (active) { setBuild(next); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to refresh the website.');
      } finally { pending = false; }
    };

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);

    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return { build, setBuild, error };
}
