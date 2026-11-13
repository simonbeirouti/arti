import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicBuild, Suggestion, Visitor } from '../../../../../packages/contracts/src/visitor-build';
import { activePreview, goalStatus, rankedSuggestions, type Preview } from './model';
import { getBuild, saveVisitor, submitSuggestion } from './client';
import { usePublicBuild } from './use-public-build';
import { useVisitorSession } from './use-visitor-session';
import './shared-website.css';

export function SharedWebsite() {
  const { build, setBuild, error } = usePublicBuild();
  const session = useVisitorSession();
  const [editingName, setEditingName] = useState(false);
  const timeline = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const contentKey = build ? JSON.stringify([build.suggestions, build.discussions, build.events]) : '';

  useEffect(() => {
    if (timeline.current && followLatest.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [contentKey]);


  return <main className="shared-website" id="main">
    <div className="shared-activity">
      <GoalPanel build={build} />
      <section className="shared-chat" aria-label="Conversation">
        {error && <p role="alert">{error}</p>}
        <div className="shared-timeline" aria-label="Agent and visitor activity" ref={timeline} onScroll={event => {
          const panel = event.currentTarget;

          followLatest.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 80;
        }}>
          {build ? <Timeline build={build} /> : <output>Connecting to Arti…</output>}
        </div>
        <VisitorControls session={session} editingName={editingName} onEditName={() => setEditingName(true)} onNameSaved={next => { session.setVisitor(next); setEditingName(false); }} onSubmitted={async () => {
          followLatest.current = true;

          if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;

          setBuild(await getBuild());
        }} />
      </section>
    </div>
    <PreviewPanel preview={build ? activePreview(build) : null} simulation={build?.mode === 'simulation'} />
  </main>;
}

function VisitorControls({ session, editingName, onEditName, onNameSaved, onSubmitted }: {
  session: ReturnType<typeof useVisitorSession>;
  editingName: boolean;
  onEditName: () => void;
  onNameSaved: (visitor: Visitor | null) => void;
  onSubmitted: () => Promise<void>;
}) {
  if (session.readOnly) return <aside className="shared-name-gate" aria-label="Read-only preview"><h2>Join on the public website</h2><p className="muted">This mirror is read-only. Visit the deployed public website to enter your name and suggest an improvement.</p></aside>;

  if (session.sessionReady && (!session.visitor || editingName)) return <section className="shared-name-gate" aria-label="Visitor name"><NameForm visitor={session.visitor} onSave={onNameSaved} /></section>;

  if (session.visitor) return <SuggestionForm visitor={session.visitor} onEditName={onEditName} onSubmitted={onSubmitted} />;

  return <section className="shared-name-gate" aria-label="Visitor session">{session.sessionLoading ? <><output>Connecting your visitor session…</output><div className="shared-session-skeleton" aria-hidden="true"><span /><span /></div></> : <><p role="alert">{session.sessionError}</p><button type="button" onClick={session.retrySession}>Retry connection</button></>}</section>;
}

export function GoalPanel({ build }: { build: PublicBuild | null }) {
  const goal = build?.currentGoal;
  const name = (id: string) => build?.entities.find(entity => entity.id === id)?.name ?? id;
  const done = goal?.tasks.filter(task => task.status === 'verified').length ?? 0;
  const agents = [...new Set(goal?.tasks.map(task => task.entityId) ?? [])];

  return <section className="shared-goal" aria-labelledby="shared-goal-heading">
    <div className="shared-goal-content"><h1 className="shared-goal-quote" id="shared-goal-heading">{goal?.title ?? 'What should we build next?'}</h1>
    {goal ? <>
      <div className="shared-goal-meta"><span>Suggested by <strong>{goal.visitorName}</strong></span><span className="shared-status">{build?.paused ? 'Paused' : goalStatus(goal.status)}</span><span>{done}/{goal.tasks.length} tasks checked</span></div>
      {goal.blocker && <p className="shared-blocker" role="alert">{goal.blocker}</p>}
      <div className="shared-goal-team"><ul className="shared-agent-chips" aria-label="Agents working on this goal">{agents.slice(0, 3).map(id => <li key={id}>{name(id)}</li>)}{agents.length > 3 && <li title={agents.slice(3).map(name).join(', ')}>+{agents.length - 3}</li>}</ul>{goal.tasks.length > 0 && <details className="shared-task-details"><summary>Task details <span>({goal.tasks.length})</span></summary><ul className="shared-tasks">{goal.tasks.map(task => <li key={task.id}><strong>{name(task.entityId)}</strong><span>{task.title}</span><small>{goalStatus(task.status)}</small></li>)}</ul></details>}</div>
    </> : <p className="shared-goal-empty">{build?.paused ? 'Agent work is paused. Suggestions are saved.' : 'Suggest an improvement in the conversation. The agents will review it together.'}</p>}{goal && build?.paused && <p className="shared-paused-note">Agent work is paused. Suggestions are saved.</p>}</div>
  </section>;
}

function MessageTime({ createdAt }: { createdAt: string }) {
  return <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>;
}

export function Timeline({ build }: { build: PublicBuild }) {
  const name = (id: string) => build.entities.find(entity => entity.id === id)?.name ?? id;

  const ranks = new Map(rankedSuggestions(build.suggestions).map((suggestion, index) => [suggestion.id, index + 1]));

  const entries = [
    ...build.suggestions.map(suggestion => ({ id: suggestion.id, createdAt: suggestion.createdAt, kind: 'visitor', content: <SuggestionCard suggestion={suggestion} entityName={name} rank={ranks.get(suggestion.id)} /> })),
    ...build.discussions.flatMap(discussion => discussion.visibility === 'public' ? [{ id: discussion.id, createdAt: discussion.createdAt, kind: 'agent', content: <><header className="shared-message-heading"><strong>{name(discussion.entityId)}</strong><span className="shared-message-role">{discussion.origin === 'simulation' ? 'Simulated agent' : 'Agent'}</span><MessageTime createdAt={discussion.createdAt} /></header><p>{discussion.body}</p></> }] : []),
    ...build.events.flatMap(event => event.visibility === 'public' && !['suggestion.review', 'suggestion.vote'].includes(event.type) ? [{ id: event.id, createdAt: event.createdAt, kind: 'event', content: <><header className="shared-message-heading"><strong>Team update</strong><MessageTime createdAt={event.createdAt} /></header><p>{event.summary}</p></> }] : []),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  return entries.length ? <ol className="shared-messages">{entries.map(entry => <li className={`shared-message shared-message-${entry.kind}`} key={entry.id}>{entry.content}</li>)}</ol> : <p className="shared-conversation-empty">Suggest something worth building. Reviews, votes and agent updates appear here.</p>;
}

function SuggestionCard({ suggestion, entityName, rank }: { suggestion: Suggestion; entityName: (id: string) => string; rank?: number }) {
  return <article>
    <header className="shared-message-heading"><strong>{suggestion.visitorName}</strong><span className="shared-message-role">Visitor</span><MessageTime createdAt={suggestion.createdAt} /></header>
    <p className="shared-suggestion-text">{suggestion.text}</p>
    <div className="shared-suggestion-status"><span className="badge">{rank ? `Queue #${rank} · ` : ''}{goalStatus(suggestion.status)}</span>{suggestion.votes.length > 0 && <span>{suggestion.votes.filter(vote => vote.approved).length}/{suggestion.votes.length} approvals</span>}</div>
    {suggestion.review && <p className="shared-review-reason"><strong>Review</strong> {suggestion.review.reason}</p>}
    {suggestion.review?.duplicateOf && <p className="muted">Linked suggestion: {suggestion.review.duplicateOf}</p>}
    {suggestion.votes.length > 0 && <ul className="shared-votes">{suggestion.votes.map(vote => <li key={vote.entityId}><div className="shared-vote-heading"><strong>{entityName(vote.entityId)}</strong><span className={vote.approved ? 'shared-vote-approve' : 'shared-vote-decline'}>{vote.approved ? 'Approve' : 'Decline'}</span><span>{vote.usefulness + vote.fit + vote.feasibility}/15</span></div><p>{vote.reason}</p></li>)}</ul>}
    {(suggestion.review || suggestion.votes.length > 0) && <details className="shared-review-details"><summary>Plan & scoring details</summary>{suggestion.review && <>{suggestion.review.brief.trim() !== suggestion.text.trim() && <p>{suggestion.review.brief}</p>}<ul>{suggestion.review.criteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ul></>}{suggestion.votes.map(vote => <p key={vote.entityId}><strong>{entityName(vote.entityId)}</strong> · Usefulness {vote.usefulness}/5 · Fit {vote.fit}/5 · Feasibility {vote.feasibility}/5</p>)}</details>}
  </article>;
}

function NameForm({ visitor, onSave }: { visitor: Visitor | null; onSave: (visitor: Visitor | null) => void }) {
  const [name, setName] = useState(visitor?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try { onSave((await saveVisitor(name.trim())).visitor); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your name.'); }
    finally { setBusy(false); }
  };

  return <form className="shared-composer shared-name-form" onSubmit={event => { void submit(event); }}>
    <label htmlFor="visitor-name">What should we call you?</label>
    <div className="shared-name-row"><input id="visitor-name" name="name" autoComplete="off" placeholder="Your public name" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /><button className="shared-primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : visitor ? 'Save name' : 'Join the conversation'}</button></div>
    <p className="muted">Names and suggestions are public. Names are unverified and may be shared.</p>
    {error && <p role="alert">{error}</p>}
  </form>;
}

function SuggestionForm({ visitor, onEditName, onSubmitted }: { visitor: Visitor; onEditName: () => void; onSubmitted: () => Promise<void> }) {
  const [text, setText] = useState('');
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      key.current ??= crypto.randomUUID();
      await submitSuggestion(text.trim(), key.current);
      setText('');
      key.current = crypto.randomUUID();
      setMessage('Suggestion submitted for agent review.');
      await onSubmitted();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to submit your suggestion.'); }
    finally { setBusy(false); }
  };

  return <form className="shared-composer" onSubmit={event => { void submit(event); }}>
    <label className="shared-sr-only" htmlFor="visitor-suggestion">Suggest an improvement as {visitor.name}</label>
    <div className="shared-input-wrapper"><textarea id="visitor-suggestion" placeholder="Suggest an improvement" required minLength={10} maxLength={2000} rows={2} value={text} disabled={busy} onChange={event => { setText(event.target.value); key.current = crypto.randomUUID(); }} /><div className="shared-composer-identity"><span className="shared-name-chip">{visitor.name}</span><button type="button" className="shared-quiet-button" aria-label="Change name" onClick={onEditName}>Edit</button></div><button className="shared-primary-button" type="submit" aria-label="Send suggestion" disabled={busy || text.trim().length < 10}>{busy ? 'Sending…' : 'Send'}</button></div>
    {message && <output className="shared-submit-message">{message}</output>}
  </form>;
}

export function PreviewPanel({ preview, simulation }: { preview: Preview | null; simulation: boolean }) {
  return <section className="shared-preview" aria-label="The website">
    {preview ? <iframe key={preview.id} title="Website being built by the agents" src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer" /> : <div className="shared-preview-empty"><h3>Waiting for the first checked release</h3><p>The website will appear here when the agents publish it.</p>{simulation && <p className="muted">Simulation · no cloud release has been verified.</p>}</div>}
  </section>;
}
