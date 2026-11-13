import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

export type AccessConfiguration = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUDIENCE?: string; OPERATOR_EMAILS?: string; OPERATOR_EMAIL?: string; OPERATOR_ORIGIN?: string };

const accessClaimsSchema = z.object({ email: z.string().email() });

const domainSchema = z.string().regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/);

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function operatorOrigin(request: Request, configuration: AccessConfiguration): boolean {
  const origin = configuration.OPERATOR_ORIGIN;

  if (!origin || new URL(request.url).origin !== origin) return false;

  return request.headers.get('Origin') === origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

export async function authenticateOperator(request: Request, configuration: AccessConfiguration): Promise<string> {
  const domain = domainSchema.parse(configuration.ACCESS_TEAM_DOMAIN);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');

  if (!token) throw new Error('Access authentication required');
  let keys = keySets.get(domain);

  if (!keys) { keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`)); keySets.set(domain, keys); }

  return verifyOperatorToken(token, configuration, keys);
}

export async function verifyOperatorToken(token: string, configuration: AccessConfiguration, keys: JWTVerifyGetKey): Promise<string> {
  const domain = domainSchema.parse(configuration.ACCESS_TEAM_DOMAIN);
  const audience = z.string().min(1).parse(configuration.ACCESS_AUDIENCE);
  const { payload } = await jwtVerify(token, keys, { audience, issuer: `https://${domain}`, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'] });
  const { email } = accessClaimsSchema.parse(payload);
  const allowed = (configuration.OPERATOR_EMAILS ?? configuration.OPERATOR_EMAIL ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

  if (!allowed.includes(email.toLowerCase())) throw new Error('Operator is not allowed');

  return email;
}
