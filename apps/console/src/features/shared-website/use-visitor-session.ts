import { useEffect, useState } from 'react';
import type { Visitor } from '../../../../../packages/contracts/src/visitor-build';
import { getVisitor, type VisitorSession } from './client';

export function useVisitorSession() {
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [readOnly, setReadOnly] = useState<VisitorSession | null>(null);
  const [sessionError, setSessionError] = useState('');
  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;

    const loadSession = async (attempt: number) => {
      try {
        const session = await getVisitor();

        if (active) {
          setVisitor(session.visitor);
          setReadOnly(session.readOnly ? session : null);
          setSessionReady(true);
          setSessionLoading(false);
          setSessionError('');
        }
      } catch {
        if (!active) return;

        if (attempt < 2) retryTimer = window.setTimeout(() => { void loadSession(attempt + 1); }, attempt === 0 ? 1000 : 2500);
        else {
          setSessionLoading(false);
          setSessionError('Your visitor session could not connect. Please try again.');
        }
      }
    };

    void loadSession(0);

    return () => { active = false; window.clearTimeout(retryTimer); };
  }, [sessionAttempt]);

  const retrySession = () => {
    setSessionLoading(true);
    setSessionError('');
    setSessionAttempt(value => value + 1);
  };

  return { visitor, setVisitor, sessionReady, readOnly, sessionLoading, sessionError, retrySession };
}
