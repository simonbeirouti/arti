import type { PublicBuild, Visitor } from '../../../../../packages/contracts/src/visitor-build';

export type VisitorSession = { visitor: Visitor | null; readOnly?: boolean; source?: string };

async function request<T>(path: string, body?: string, signal?: AbortSignal): Promise<T> {
  const options: RequestInit = { credentials: 'same-origin' };

  if (signal) options.signal = signal;

  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = body;
  }

  const response = await fetch(path, options);

  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`;

    if (response.headers.get('content-type')?.includes('application/json')) {
      const problem: { error?: string } = await response.json();

      if (problem.error) message = problem.error;
    }

    throw new Error(message);
  }

  return response.json();
}

export const getBuild = (): Promise<PublicBuild> => request('/api/v1/public/build');

export const getVisitor = (): Promise<VisitorSession> => request('/api/v1/visitor/session', undefined, AbortSignal.timeout(8000));

export const saveVisitor = (name: string): Promise<VisitorSession> => request('/api/v1/visitor/session', JSON.stringify({ name }));

export const submitSuggestion = (text: string, idempotencyKey: string): Promise<void> => request('/api/v1/visitor/suggestions', JSON.stringify({ text, idempotencyKey }));
