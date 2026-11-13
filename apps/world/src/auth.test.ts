import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { operatorOrigin, verifyOperatorToken } from './auth';

const configuration = { ACCESS_TEAM_DOMAIN: 'arti.cloudflareaccess.com', ACCESS_AUDIENCE: 'operator-app', OPERATOR_EMAILS: 'owner@example.com', OPERATOR_ORIGIN: 'https://operator.example.com' };

it('checks issuer audience signature email allowlist and expiry without network', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'local-key', alg: 'RS256' }] });
  const token = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'local-key' }).setIssuer('https://arti.cloudflareaccess.com').setAudience('operator-app').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  expect(await verifyOperatorToken(token, configuration, keys)).toBe('owner@example.com');
  await expect(verifyOperatorToken(token, { ...configuration, ACCESS_AUDIENCE: 'wrong-app' }, keys)).rejects.toThrow();
  await expect(verifyOperatorToken(token, { ...configuration, OPERATOR_EMAILS: 'other@example.com' }, keys)).rejects.toThrow('not allowed');
  const expired = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'local-key' }).setIssuer('https://arti.cloudflareaccess.com').setAudience('operator-app').setExpirationTime(1).sign(privateKey);
  await expect(verifyOperatorToken(expired, configuration, keys)).rejects.toThrow();
});

it('rejects missing foreign or cross-site operator origins', () => {
  expect(operatorOrigin(new Request('https://operator.example.com/api/v1/commands', { method: 'POST', headers: { Origin: 'https://operator.example.com' } }), configuration)).toBe(true);
  expect(operatorOrigin(new Request('https://operator.example.com/api/v1/commands', { method: 'POST' }), configuration)).toBe(false);
  expect(operatorOrigin(new Request('https://operator.example.com/api/v1/commands', { method: 'POST', headers: { Origin: 'https://entity.example.com' } }), configuration)).toBe(false);
});
