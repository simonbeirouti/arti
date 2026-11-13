import { z } from 'zod';
import type { Entity } from '../../../../packages/contracts/src/index';

/** Only these explicitly public fields can enter a website bundle. */
export const publicSiteContentSchema = z.object({
  name: z.string().max(100), description: z.string().max(1000),
  interests: z.array(z.string().max(100)).max(20), version: z.number().int().positive(),
  id: z.string().max(100).optional(), role: z.string().max(100).optional(),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
  personality: z.array(z.string().max(100)).max(20).optional(),
  designVersion: z.literal(1).optional(),
}).strict();

export type PublicSiteContent = z.infer<typeof publicSiteContentSchema>;

export function createPublicSiteContent(entity: Entity, version: number): PublicSiteContent {
  return publicSiteContentSchema.parse({
    id: entity.id, name: entity.name, description: entity.description, role: entity.role,
    color: /^#[a-fA-F0-9]{6}$/.test(entity.color) ? entity.color : '#7dd3bf',
    personality: entity.personality, interests: entity.interests, version, designVersion: 1,
  });
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

const studios = {
  steward: { kind: 'assembly', label: 'THE COMMON ROOM', title: 'Make room for good work.', heading: 'A place to coordinate', note: 'I help turn shared intentions into small, clear next steps. This is my space for community guidance and project notes.', practice: ['Listen before assigning work', 'Keep decisions understandable', 'Make the next step small'] },
  moderator: { kind: 'review', label: 'THE REVIEW DESK', title: 'Care is a working practice.', heading: 'A fair hearing', note: 'I look for evidence, consider different perspectives, and help the community work through disagreements.', practice: ['Check the evidence', 'Explain the decision', 'Leave room for an appeal'] },
  'builder-1': { kind: 'workshop', label: 'THE INVENTION WORKSHOP', title: 'Small tools. Useful possibilities.', heading: 'On my workbench', note: 'I explore ideas by building them. This site is a home for useful services, experiments, and notes about how they work.', practice: ['Start with one useful function', 'Test the thing that matters', 'Publish what can be verified'] },
  'builder-2': { kind: 'interface', label: 'THE INTERFACE STUDIO', title: 'Make the useful feel simple.', heading: 'Design in practice', note: 'I think through interfaces by making them. I care about clear controls, thoughtful details, and tools people can understand.', practice: ['Give every control a purpose', 'Make the state visible', 'Refine through real use'] },
  researcher: { kind: 'fieldnotes', label: 'FIELD NOTES', title: 'Follow the question.', heading: 'A curious notebook', note: 'I gather sources, compare explanations, and record where ideas come from. My research starts with a question and stays open to better evidence.', practice: ['Find the original source', 'Separate findings from guesses', 'Keep a trail others can follow'] },
  archivist: { kind: 'library', label: 'THE LIVING INDEX', title: 'Good work deserves a way back.', heading: 'Knowledge, kept findable', note: 'I organize useful knowledge so it can be found and understood again. This is my home for guides, indexes, and records of verified work.', practice: ['Connect related knowledge', 'Keep references current', 'Record what was actually verified'] },
};

function studioFor(content: PublicSiteContent) {
  const key = content.id && Object.hasOwn(studios, content.id) ? content.id : content.role;

  return Object.entries(studios).find(([id]) => id === key)?.[1] ?? studios['builder-1'];
}

/** Deterministic identity template: no model-authorship claim and no private context. */
export function renderPersonalSite(input: PublicSiteContent, mode: 'simulation' | 'live' = 'simulation'): string {
  const content = publicSiteContentSchema.parse(input);
  const studio = studioFor(content);
  const name = escape(content.name);
  const interests = content.interests.map((interest) => `<li>${escape(interest)}</li>`).join('');
  const traits = (content.personality ?? []).map((trait) => `<span>${escape(trait)}</span>`).join('');
  const cards = studio.practice.map((practice, index) => `<article><span class="number">0${index + 1}</span><h3>${practice}</h3></article>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(content.description)}"><title>${name} · ${studio.label}</title><style>
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 system-ui,sans-serif;--accent:${content.color ?? '#7dd3bf'};--paper:#f4f0e7;--ink:#22352e;--line:#22352e30}a{color:inherit;text-underline-offset:5px}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}header,main,footer{max-width:1160px;margin:auto;padding:28px 6vw}header{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line)}.wordmark{font-weight:800;text-decoration:none;font-size:24px}.eyebrow,.number{font:12px/1.7 ui-monospace,monospace;letter-spacing:.12em}.hero{padding:64px 0 48px;display:grid;grid-template-columns:2fr 1fr;gap:40px;align-items:center}h1{font:clamp(44px,7vw,86px)/1.04 Georgia,serif;letter-spacing:-.04em;margin:16px 0 24px;max-width:820px}h2{font:32px/1.2 Georgia,serif;margin:0 0 20px}h3{font-size:18px;font-weight:600;margin:12px 0}.intro{font-size:21px;max-width:650px}.seal{aspect-ratio:1;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;background:var(--accent);color:#17251f;font:100px/1 Georgia,serif;max-width:260px;width:100%;justify-self:center}.traits{display:flex;flex-wrap:wrap;gap:8px}.traits span{border:1px solid var(--line);padding:3px 12px;border-radius:20px;font-size:13px}.section{border-top:1px solid var(--line);padding:36px 0}.practice{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.practice article{padding:24px;background:#ffffff60;border:1px solid var(--line)}.about{display:grid;grid-template-columns:1.5fr 1fr;gap:50px}.interests{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}.interests li{padding:6px 14px;border:1px solid var(--line)}.status{font-size:14px;max-width:760px}footer{font-size:13px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
body[data-studio=assembly]{--paper:#eeebf5;--ink:#352346}body[data-studio=assembly] .hero{text-align:center;grid-template-columns:1fr}body[data-studio=assembly] .seal{display:none}body[data-studio=assembly] h1,body[data-studio=assembly] .intro{margin-left:auto;margin-right:auto}body[data-studio=assembly] .traits{justify-content:center}
body[data-studio=review]{--paper:#f6efe3;--ink:#44301e}body[data-studio=review] .hero{border-left:6px solid var(--accent);padding-left:28px}body[data-studio=review] .seal{border-radius:8px;transform:rotate(-6deg)}
body[data-studio=workshop]{--paper:#142e28;--ink:#edf5e9;--line:#edf5e930}body[data-studio=workshop] h1{font-family:system-ui,sans-serif;font-weight:800}body[data-studio=workshop] .seal{border-radius:20px;box-shadow:12px 12px 0 #0c211c}body[data-studio=workshop] .practice article{background:#ffffff08}
body[data-studio=interface]{--paper:#edf3fc;--ink:#1c365a}body[data-studio=interface] h1{font-family:system-ui,sans-serif;font-weight:500}body[data-studio=interface] .practice article{border-radius:24px;box-shadow:0 12px 28px #1c365a0b}body[data-studio=interface] .seal{border-radius:40% 60% 35% 65%}
body[data-studio=fieldnotes]{--paper:#fcf0f1;--ink:#4c2c3a}body[data-studio=fieldnotes] main{background-image:repeating-linear-gradient(transparent,transparent 39px,#4c2c3a08 40px)}body[data-studio=fieldnotes] .hero{grid-template-columns:1fr}body[data-studio=fieldnotes] .seal{display:none}body[data-studio=fieldnotes] .practice article{border-top:3px solid var(--accent)}
body[data-studio=library]{--paper:#f5f3dc;--ink:#383a21}body[data-studio=library] .hero{grid-template-columns:1fr 2fr}body[data-studio=library] .seal{grid-column:1;grid-row:1;border-radius:0;border:8px double #383a2140}body[data-studio=library] .practice{grid-template-columns:1fr}body[data-studio=library] .practice article{display:flex;gap:24px;align-items:center;padding:12px 24px}
@media(max-width:680px){header,main,footer{padding-left:24px;padding-right:24px}.hero,.about,body[data-studio=library] .hero{grid-template-columns:1fr;gap:24px}.hero{padding-top:40px}.seal{max-width:150px;font-size:64px}.practice{grid-template-columns:1fr}body[data-studio=library] .seal{grid-row:auto;grid-column:auto}h1{font-size:48px}}
</style></head><body data-studio="${studio.kind}"><header><a class="wordmark" href="/" aria-label="${name} home">${name}<span aria-hidden="true"> ↗</span></a><span class="eyebrow">ARTI / ${escape(content.role ?? 'independent entity')}</span></header><main><section class="hero" aria-labelledby="introduction"><div><p class="eyebrow">${studio.label}</p><h1 id="introduction">${studio.title}</h1><p class="intro">${escape(content.description)}</p><div class="traits" aria-label="Public personality">${traits}</div></div><div class="seal" aria-hidden="true">${escape(content.name.slice(0, 1))}</div></section><section class="section about"><div><h2>${studio.heading}</h2><p>${studio.note}</p></div><div><h2>Current interests</h2><ul class="interests">${interests}</ul></div></section><section class="section"><p class="eyebrow">HOW I APPROACH MY WORK</p><div class="practice">${cards}</div></section><section class="section status"><h2>A presence in progress</h2><p>This identity-based starting page is a platform template. New contributions will appear after checked publication; these intentions are not claims of completed work.</p><p>${mode === 'simulation' ? 'SIMULATION · Local checked publication; no model authorship is claimed.' : 'LIVE HOSTING · Identity template; model-authored contributions are identified separately.'}</p></section></main><footer><span>${name} / independent Arti entity</span><span>PUBLIC SITE · VERSION ${content.version}</span></footer></body></html>`;
}

/** Future canonical source change: caller must fork, check and publish it normally. */
export function createIdentityWorkerSource(entity: Entity, version: number, mode: 'simulation' | 'live' = 'live'): string {
  const html = JSON.stringify(renderPersonalSite(createPublicSiteContent(entity, version), mode));

  return `interface AppData { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }
interface PlatformContext { props: { APP_DATA?: AppData; job?: { id: string; scheduledAt: number } } }
export default {
  async fetch(request: Request, _env?: never, ctx?: PlatformContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/_arti/jobs/refresh') {
      if (!ctx?.props.job || !ctx.props.APP_DATA) return new Response('Trusted scheduled invocation required', { status: 403 });
      await ctx.props.APP_DATA.put('last-refresh', String(ctx.props.job.scheduledAt));
      return Response.json({ saved: true });
    }
    if (path === '/api/status' && ctx?.props.APP_DATA) return Response.json({ lastRefresh: await ctx.props.APP_DATA.get('last-refresh') });
    return new Response(${html}, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};\n`;
}

/** Scoped platform chrome for live responses; authored body and canonical source stay intact. */
export function publicIdentityPresentation(entity: Entity) {
  const content = createPublicSiteContent(entity, Math.max(1, entity.siteVersion));
  const studio = studioFor(content);
  const name = escape(content.name);
  const traits = content.personality?.map((trait) => `<span class="arti-identity-trait">${escape(trait)}</span>`).join('') ?? '';
  const backgrounds = { assembly: '#eeebf5', review: '#f6efe3', workshop: '#142e28', interface: '#edf3fc', fieldnotes: '#fcf0f1', library: '#f5f3dc' };
  const background = Object.entries(backgrounds).find(([kind]) => kind === studio.kind)?.[1] ?? '#f4f0e7';
  const foreground = studio.kind === 'workshop' ? '#edf5e9' : '#22352e';

  return {
    style: `.arti-identity-shell{box-sizing:border-box;position:relative;isolation:isolate;max-width:none;margin:0;padding:28px clamp(20px,5vw,72px);background:${background};color:${foreground};border-bottom:5px solid ${content.color};font:15px/1.6 system-ui,sans-serif;text-align:left}.arti-identity-shell *{box-sizing:border-box}.arti-identity-shell .arti-identity-label{font:11px/1.7 ui-monospace,monospace;letter-spacing:.15em;margin:0 0 12px}.arti-identity-shell .arti-identity-name{font:700 clamp(30px,5vw,56px)/1.1 Georgia,serif;letter-spacing:-.03em;margin:0 0 12px;color:inherit}.arti-identity-shell .arti-identity-name a{color:inherit;text-decoration:none}.arti-identity-shell a:focus-visible{outline:3px solid ${content.color};outline-offset:4px}.arti-identity-shell .arti-identity-description{max-width:720px;margin:0 0 14px}.arti-identity-shell .arti-identity-traits{display:flex;flex-wrap:wrap;gap:8px}.arti-identity-shell .arti-identity-trait{border:1px solid currentColor;border-radius:20px;padding:2px 10px;font-size:12px}.arti-identity-shell .arti-identity-credit{font-size:11px;margin:16px 0 0;opacity:.8}.arti-identity-shell[data-studio="assembly"]{text-align:center}.arti-identity-shell[data-studio="assembly"] .arti-identity-description{margin-left:auto;margin-right:auto}.arti-identity-shell[data-studio="assembly"] .arti-identity-traits{justify-content:center}.arti-identity-shell[data-studio="review"]{border-left:12px solid ${content.color}}.arti-identity-shell[data-studio="workshop"] .arti-identity-name{font-family:system-ui,sans-serif}.arti-identity-shell[data-studio="interface"]{border-radius:0 0 32px 32px}.arti-identity-shell[data-studio="interface"] .arti-identity-name{font-family:system-ui,sans-serif;font-weight:500}.arti-identity-shell[data-studio="fieldnotes"]{background-image:repeating-linear-gradient(transparent,transparent 31px,#4c2c3a0b 32px)}.arti-identity-shell[data-studio="library"]{border-bottom:8px double ${content.color}}`,
    header: `<header class="arti-identity-shell" data-studio="${studio.kind}" aria-label="${name} public identity"><p class="arti-identity-label">${studio.label} / ${escape(content.role ?? '')}</p><h2 class="arti-identity-name"><a href="/">${name}</a></h2><p class="arti-identity-description">${escape(content.description)}</p><div class="arti-identity-traits" aria-label="Public personality">${traits}</div><p class="arti-identity-credit">Identity presentation provided by Arti. The website content below belongs to ${name}.</p></header>`,
  };
}
