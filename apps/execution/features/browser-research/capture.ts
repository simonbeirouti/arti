import { LiveGate } from '../../../../packages/provider-adapters/src/cloudflare';

export interface BrowserCaptureBinding { quickAction(action: 'screenshot', options: BrowserRunScreenshotOptions): Promise<Response> }

export interface CaptureStore { put(key: string, content: ArrayBuffer | string, options?: { httpMetadata?: { contentType: string } }): Promise<R2Object | null> }

export class BrowserResearch {
  constructor(private readonly browser: BrowserCaptureBinding, private readonly store: CaptureStore, private readonly gate: LiveGate, private readonly allowedHosts: readonly string[]) {}
  async capture(entityId: string, rawUrl: string): Promise<{ key: string; provenanceKey: string; sha256: string; trust: 'untrusted'; visibility: 'private' }> {
    const url = new URL(rawUrl);

    if (url.protocol !== 'https:' || url.username || url.password || url.port || !this.allowedHosts.includes(url.hostname)) throw new Error('Browser origin is not approved');

    return this.captureOptions(entityId, { url: url.href, allowRequestPattern: [`^https://${url.hostname.replaceAll('.', '\\.')}(/|$)`], setJavaScriptEnabled: false, rejectResourceTypes: ['script', 'websocket'], gotoOptions: { timeout: 15_000 }, screenshotOptions: { type: 'png' }, cacheTTL: 0 }, url.href, 'private');
  }
  /** Only trusted platform fixture HTML can request public-safe captures. Not an agent tool. */
  async capturePublicFixture(entityId: string, fixtureId: string, html: string): Promise<{ key: string; provenanceKey: string; sha256: string; trust: 'untrusted'; visibility: 'public-safe' }> {
    if (!/^[a-z0-9_-]{1,80}$/.test(fixtureId) || html.length > 100_000) throw new Error('Invalid public fixture');

    return this.captureOptions(entityId, { html, rejectRequestPattern: ['.*'], setJavaScriptEnabled: false, screenshotOptions: { type: 'png' }, cacheTTL: 0 }, `fixture:${fixtureId}`, 'public-safe');
  }
  private async captureOptions<V extends 'private' | 'public-safe'>(entityId: string, options: BrowserRunScreenshotOptions, source: string, visibility: V): Promise<{ key: string; provenanceKey: string; sha256: string; trust: 'untrusted'; visibility: V }> {
    return this.gate.run(entityId, 0.02, 'research.browser', async () => {
      const response = await this.browser.quickAction('screenshot', options);

      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/png')) throw new Error('Browser did not return a PNG capture');
      const bytes = await response.arrayBuffer();

      if (bytes.byteLength > 10_000_000) throw new Error('Browser capture exceeds size limit');
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      const prefix = visibility === 'private' ? 'private-research' : 'public-fixtures';
      const key = `${prefix}/${entityId}/${crypto.randomUUID()}.png`;
      const provenanceKey = `${key}.json`;
      await this.store.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
      await this.store.put(provenanceKey, JSON.stringify({ source, sha256, capturedAt: new Date().toISOString(), visibility, trust: 'untrusted', cookies: false, javascript: false }));

      return { key, provenanceKey, sha256, trust: 'untrusted', visibility };
    });
  }
}
