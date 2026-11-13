import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Actor } from '../packages/contracts/src/index';

export class LocalAuthentication {
  readonly session = randomBytes(32).toString('hex');
  readonly tokens: Map<string, string>;

  constructor(tokens: Map<string, string>) {
    this.tokens = tokens;
  }

  authenticate(request: IncomingMessage): Actor | null {
    const bearer = request.headers.authorization?.replace(/^Bearer /u, '');

    if (bearer) {
      const candidate = createHash('sha256').update(bearer).digest();

      for (const [id, token] of this.tokens) {
        const expected = createHash('sha256').update(token).digest();

        if (timingSafeEqual(candidate, expected)) return { role: 'entity', entityId: id };
      }

      return null;
    }

    const cookies = request.headers.cookie?.split(';').map((value) => value.trim()) ?? [];

    if (cookies.includes(`arti_session=${this.session}`)) return { role: 'operator' };

    return null;
  }
}

export function allowedOrigin(request: IncomingMessage, consolePort: number): boolean {
  const origin = request.headers.origin;

  if (request.headers['sec-fetch-site'] === 'cross-site') return false;

  return !origin || origin === `http://localhost:${consolePort}` || origin === `http://127.0.0.1:${consolePort}`;
}
