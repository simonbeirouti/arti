import { publicationEnabled, type PublicationConfiguration } from './gate';
import type { ApplicationDataApi } from '../application-services/data';
import type { PublicWorld } from '../../../../packages/contracts/src/index';

export interface DispatchBinding { get(name: string, args?: { props: { APP_DATA: ApplicationDataApi; job?: { id: string; scheduledAt: number } } }, options?: DynamicDispatchOptions): { fetch(request: Request): Promise<Response> } }

export interface DispatchEnvironment extends PublicationConfiguration { DISPATCH: DispatchBinding; ENTITY_DOMAIN: string; SHOWCASE_HOSTNAME?: string; WORLD: { getByName(name: string): { publicState(): Promise<PublicWorld> } } }

export async function dispatch(request: Request, environment: DispatchEnvironment, applicationData?: (entityId: string) => ApplicationDataApi): Promise<Response> {
  if (!publicationEnabled(environment)) return new Response('Entity publication disabled', { status: 503 });
  const url = new URL(request.url);

  if (url.pathname.startsWith('/_arti/')) return new Response('Not found', { status: 404 });
  const suffix = `.${environment.ENTITY_DOMAIN}`;

  const showcase = environment.SHOWCASE_HOSTNAME && url.hostname === environment.SHOWCASE_HOSTNAME;
  const entityId = showcase ? 'collective' : url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : '';

  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(entityId)) return new Response('Not found', { status: 404 });
  const world = await environment.WORLD.getByName('arti-world').publicState();
  const project = world.projects?.find(project => (showcase || entityId === project.id) && (showcase ? project.id === 'collective' : true));

  if (world.projects?.length && !project) return new Response('Personal websites are retired', { status: 404 });
  const targetId = project?.id ?? entityId;
  const deployment = world.deployments.findLast(deployment => (project ? deployment.projectId === project.id : deployment.entityId === entityId && !deployment.projectId) && deployment.environment === 'production');
  const workerName = deployment?.workerName;

  if (!workerName || workerName !== `${targetId.slice(0, 15)}-${deployment.bundleHash}`) return new Response('Entity has no active deployment', { status: 404 });

  const headers = new Headers(request.headers);

  for (const header of ['cookie', 'authorization', 'cf-access-jwt-assertion', 'cf-access-authenticated-user-email']) headers.delete(header);
  const upstream = await environment.DISPATCH.get(workerName, applicationData ? { props: { APP_DATA: applicationData(targetId) } } : undefined, { limits: { cpuMs: 50, subRequests: 20 } }).fetch(new Request(request, { headers }));
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('referrer-policy', 'no-referrer');

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
