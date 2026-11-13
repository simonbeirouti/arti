import { PublicBrief } from "./public-brief";
import { useState } from "react";
import type { FormEvent } from "react";
import type {
  Command,
  Entity,
  Goal,
  PublicWorld,
  WorldState,
} from "../../../../../packages/contracts/src/index";
import { Badge, SectionHeading } from "../../../../../packages/ui/src/index";
import {
  currentGoal,
  entityShowcase,
  lines,
  readable,
  formatTime,
} from "./view-model";
import type { Dispatch } from "./types";

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="stat">
      <p>{label}</p>
      <strong>{String(value).padStart(2, "0")}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function EntityCard({
  entity,
  history,
}: {
  entity: Entity;
  history: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const showcase = entityShowcase(entity);

  return (
    <article className="entity-card">
      <div className="entity-top">
        <span
          className="entity-avatar"
          style={{ backgroundColor: entity.color }}
        >
          {entity.name.slice(0, 1)}
        </span>
        <Badge tone={entity.status === "working" ? "green" : "neutral"}>
          {entity.status}
        </Badge>
      </div>
      <p className="eyebrow">{entity.role}</p>
      <h3>{entity.name}</h3>
      <p className="entity-description">{entity.description}</p>
      <div className="tags">
        {entity.personality.slice(0, 3).map((trait) => (
          <span key={trait}>{trait}</span>
        ))}
      </div>
      <div className="entity-footer">
        <a href={showcase}>Shared project contributions →</a>
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Less" : "Profile"}
        </button>
      </div>
      {expanded && (
        <div className="entity-detail">
          <p>
            <strong>Stable identity</strong>
            <br />
            <code>{entity.id}</code>
          </p>
          <p>
            <strong>Interests</strong>
            <br />
            {entity.interests.join(", ")}
          </p>
          <p>
            <strong>Personality changes</strong>
            <br />
            {history.join(", ") || "No revisions yet"}
          </p>
        </div>
      )}
    </article>
  );
}

export function GoalPanel({
  state,
  dispatch,
  busy,
}: {
  state: WorldState;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const goal = currentGoal(state);
  const [editing, setEditing] = useState(false);

  if (!goal || ["completed", "cancelled"].includes(goal.status))
    return (
      <section className="goal-panel">
        <div>
          <p className="eyebrow">A shared purpose</p>
          <h2>
            {goal?.status === "completed"
              ? "A goal completed. A world still growing."
              : "What should the team build?"}
          </h2>
          <p className="muted">
            Ask a question or describe a useful improvement. The team plans, builds and verifies it in one shared project.
          </p>
        </div>
        <GoalForm dispatch={dispatch} busy={busy} />
      </section>
    );

  const revision =
    goal.revisions.find((item) => item.revision === goal.revision) ??
    goal.revisions.at(-1);

  const tasks = state.tasks.filter(
    (task) => task.goalId === goal.id && task.revision === goal.revision,
  );

  const currentCriteria = new Set(revision?.criteria);

  const verified = new Set(
    state.evidence.flatMap((item) =>
      item.goalId === goal.id &&
      item.revision === goal.revision &&
      item.status === "verified" &&
      currentCriteria.has(item.criterion)
        ? [item.criterion]
        : [],
    ),
  );

  const control = (
    action: "pause" | "resume" | "cancel" | "accept" | "request_changes",
    feedback = "",
  ) => {
    void dispatch({
      type: "goal.control",
      goalId: goal.id,
      expectedRevision: goal.revision,
      action,
      feedback,
    });
  };

  return (
    <section className="goal-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared goal · revision {goal.revision}</p>
          <h2>{revision?.objective}</h2>
        </div>
        <Badge tone={goal.status === "active" ? "green" : "amber"}>
          {readable(goal.status)}
        </Badge>
      </div>
      <div className="goal-summary">
        <span>
          <strong>{verified.size}</strong> / {revision?.criteria.length ?? 0}{" "}
          criteria verified
        </span>
        <span>
          <strong>
            {tasks.filter((task) => task.status === "verified").length}
          </strong>{" "}
          / {tasks.length} tasks verified
        </span>
        <span>Human acceptance required</span>
      </div>
      <ul className="criteria-list">
        {revision?.criteria.map((criterion) => (
          <li key={criterion}>
            <span
              className={
                verified.has(criterion) ? "criterion-done" : "criterion-open"
              }
              aria-label={verified.has(criterion) ? "Verified" : "Pending"}
            >
              {verified.has(criterion) ? "✓" : "○"}
            </span>
            {criterion}
          </li>
        ))}
      </ul>
      {revision?.constraints.length ? (
        <p className="muted">Constraints: {revision.constraints.join(" · ")}</p>
      ) : null}
      <GoalActions
        mode={state.mode}
        goal={goal}
        dispatch={dispatch}
        busy={busy}
        onEdit={() => setEditing(!editing)}
        control={control}
      />
      {editing && revision && (
        <GoalForm
          key={goal.revision}
          goal={goal}
          objective={revision.objective}
          criteria={revision.criteria.join("\n")}
          constraints={revision.constraints.join("\n")}
          dispatch={dispatch}
          busy={busy}
          onDone={() => setEditing(false)}
        />
      )}
      <PublicBrief
        key={`${goal.id}:${goal.revision}`}
        goal={goal}
        dispatch={dispatch}
        busy={busy}
      />
      {tasks.length > 0 && (
        <div className="task-list">
          <p className="eyebrow">Work in progress · dependencies respected</p>
          {tasks.map((task) => (
            <div className="task-row" key={task.id}>
              <span className={`task-state ${task.status}`} aria-hidden="true">
                {task.status === "verified" ? "✓" : "○"}
              </span>
              <div>
                <strong>{task.title}</strong>
                <small>
                  {
                    state.entities.find((entity) => entity.id === task.entityId)
                      ?.name
                  }{" "}
                  {task.dependencies.length
                    ? `· after ${task.dependencies.join(", ")}`
                    : "· ready to begin"}
                </small>
              </div>
              <Badge tone={task.status === "verified" ? "green" : "neutral"}>
                {task.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {state.confirmations.flatMap((confirmation) =>
        confirmation.goalId === goal.id && confirmation.status === "pending"
          ? [
              <ConfirmationForm
                key={confirmation.id}
                id={confirmation.id}
                revision={confirmation.revision}
                question={confirmation.question}
                dispatch={dispatch}
                busy={busy}
              />,
            ]
          : [],
      )}
    </section>
  );
}

function GoalActions({
  mode,
  goal,
  dispatch,
  busy,
  onEdit,
  control,
}: {
  mode: WorldState["mode"];
  goal: Goal;
  dispatch: Dispatch;
  busy: boolean;
  onEdit: () => void;
  control: (
    action: "pause" | "resume" | "cancel" | "accept" | "request_changes",
    feedback?: string,
  ) => void;
}) {
  return (
    <>
      <div className="goal-actions">
        {goal.status === "draft" && (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={onEdit}
          >
            Edit goal draft
          </button>
        )}
        {goal.status === "draft" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              void dispatch({ type: "goal.start", goalId: goal.id });
            }}
          >
            Start shared goal →
          </button>
        )}
        {["active", "blocked", "paused", "awaiting_acceptance"].includes(
          goal.status,
        ) && (
          <>
            <button className="button" disabled={busy} onClick={onEdit}>
              Change direction
            </button>
            {goal.status !== "awaiting_acceptance" && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  control(goal.status === "paused" ? "resume" : "pause")
                }
              >
                {goal.status === "paused" ? "Resume goal" : "Pause goal"}
              </button>
            )}
            <button
              className="button danger"
              disabled={busy}
              onClick={() => control("cancel")}
            >
              Cancel goal
            </button>
          </>
        )}
        {goal.status === "awaiting_acceptance" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => control("accept")}
          >
            {mode === "simulation"
              ? "Accept simulated completion ✓"
              : "Accept verified completion ✓"}
          </button>
        )}
      </div>
      {goal.status === "awaiting_acceptance" && mode === "simulation" && (
        <p className="muted">
          This submission verifies deterministic simulation fixtures only. It
          does not establish that arbitrary goal semantics or cloud execution
          succeeded.
        </p>
      )}
      {goal.status === "awaiting_acceptance" && (
        <FeedbackForm
          busy={busy}
          onSubmit={(feedback) => control("request_changes", feedback)}
        />
      )}
    </>
  );
}

function GoalForm({
  goal,
  objective = "",
  criteria = "",
  constraints = "",
  dispatch,
  busy,
  onDone,
}: {
  goal?: Goal;
  objective?: string;
  criteria?: string;
  constraints?: string;
  dispatch: Dispatch;
  busy: boolean;
  onDone?: () => void;
}) {
  const [step, setStep] = useState(goal ? 1 : 0);
  const [values, setValues] = useState({ objective, criteria, constraints });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (step === 0) {
      setStep(1);

      return;
    }

    const fields = {
      objective: values.objective,
      criteria: lines(values.criteria),
      constraints: lines(values.constraints),
    };

    const command: Command = goal
      ? {
          type: "goal.revise",
          goalId: goal.id,
          expectedRevision: goal.revision,
          ...fields,
        }
      : { type: "goal.create", ...fields };

    void dispatch(command).then((success) => {
      if (success) onDone?.();
    });
  };

  return (
    <form className="goal-form" onSubmit={submit}>
      <div className="intake-message">
        <span className="avatar-small">a</span>
        <p>
          {step === 0
            ? "What would you like this world to work towards?"
            : "How will we know the goal is complete? Set clear outcomes for the agents to verify."}
        </p>
      </div>
      <label htmlFor="goal-objective">
        {goal ? "Updated direction" : "Your shared goal"}
      </label>
      <textarea
        id="goal-objective"
        placeholder="Build a public knowledge resource about…"
        minLength={5}
        maxLength={4000}
        required
        value={values.objective}
        onChange={(event) =>
          setValues({ ...values, objective: event.target.value })
        }
      />
      {step === 1 && (
        <>
          <label htmlFor="goal-criteria">
            Acceptance criteria <small>One outcome per line</small>
          </label>
          <textarea
            id="goal-criteria"
            placeholder="Publish a useful, tested resource…"
            required
            minLength={3}
            value={values.criteria}
            onChange={(event) =>
              setValues({ ...values, criteria: event.target.value })
            }
          />
          <label htmlFor="goal-constraints">
            Constraints <small>Optional · one per line</small>
          </label>
          <textarea
            id="goal-constraints"
            placeholder="Use public sources only"
            value={values.constraints}
            onChange={(event) =>
              setValues({ ...values, constraints: event.target.value })
            }
          />
        </>
      )}
      <div className="form-actions">
        <small>
          {step === 0
            ? "Start with a goal. Keep the details flexible."
            : "Creates a versioned record. Discussion becomes read only once started."}
        </small>
        <button className="button primary" disabled={busy} type="submit">
          {step === 0
            ? "Continue →"
            : goal
              ? "Save new direction →"
              : "Create goal draft →"}
        </button>
      </div>
    </form>
  );
}

function FeedbackForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState("");

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(feedback);
      }}
    >
      <label htmlFor="completion-feedback">Request changes to the result</label>
      <input
        id="completion-feedback"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        required
        placeholder="What still needs to change?"
      />
      <button type="submit" className="button" disabled={busy}>
        Request changes
      </button>
    </form>
  );
}

function ConfirmationForm({
  id,
  revision,
  question,
  dispatch,
  busy,
}: {
  id: string;
  revision: number;
  question: string;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <form
      className="confirmation panel"
      onSubmit={(event) => {
        event.preventDefault();
        void dispatch({
          type: "confirmation.respond",
          confirmationId: id,
          expectedRevision: revision,
          answer,
        });
      }}
    >
      <Badge tone="amber">Your direction is needed</Badge>
      <label htmlFor={`answer-${id}`}>{question}</label>
      <input
        id={`answer-${id}`}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        required
      />
      <button type="submit" className="button" disabled={busy}>
        Send confirmation
      </button>
    </form>
  );
}

export function Activity({
  events,
  entityName,
  discussionHref,
}: {
  events: PublicWorld["events"];
  discussionHref: string;
  entityName: (id: string) => string;
}) {
  return (
    <section className="activity-section">
      <SectionHeading eyebrow="The world journal" title="Recent activity">
        <a href={discussionHref}>View conversations ↗</a>
      </SectionHeading>
      <div className="panel activity-list">
        {events.map((event) => (
          <div className="activity-row" key={event.id}>
            <span className="activity-dot" />
            <div>
              <p>{event.summary}</p>
              <small>
                {entityName(event.actorId)} · {readable(event.type)}
              </small>
            </div>
            <time>{formatTime(event.createdAt)}</time>
          </div>
        ))}
        {!events.length && (
          <p className="muted">
            The world is ready. Its first actions will appear here.
          </p>
        )}
      </div>
    </section>
  );
}

export function Operations({
  state,
  dispatch,
  busy,
}: {
  state: WorldState;
  dispatch: Dispatch;
  busy: boolean;
}) {
  return (
    <>
      <SectionHeading title="A world you can account for">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            void dispatch({ type: "world.pause", paused: !state.paused });
          }}
        >
          {state.paused ? "Resume world" : "Pause entire world"}
        </button>
      </SectionHeading>
      <div className="stats-grid">
        <Stat
          label="Daily allowance"
          value={state.budget.dailyUsd}
          detail="USD · live activity remains gated"
        />
        <Stat
          label="Actual spend"
          value={state.budget.spentUsd}
          detail="Recorded provider usage"
        />
        <Stat
          label="Tool receipts"
          value={state.receipts.length}
          detail="Inspectable execution history"
        />
        <Stat
          label="Simulation turns"
          value={state.turn}
          detail="Controlled local clock"
        />
      </div>
      <div className="two-column">
        <section className="panel">
          <h3>Runtime boundaries</h3>
          <BudgetControls state={state} dispatch={dispatch} busy={busy} />
          <dl className="operations-list">
            <dt>Mode</dt>
            <dd>{state.mode}</dd>
            <dt>World dispatch</dt>
            <dd>{state.paused ? "Paused" : "Available"}</dd>
            <dt>Reserved allowance</dt>
            <dd>${state.budget.reservedUsd.toFixed(2)}</dd>
            <dt>Blocked tasks</dt>
            <dd>
              {state.tasks.filter((task) => task.status === "blocked").length}
            </dd>
            <dt>Cloud verification</dt>
            <dd>
              {state.evidence.some(
                (run) =>
                  run.environment !== "simulation" && run.status === "verified",
              )
                ? "Checked live receipts recorded"
                : "Not established"}
            </dd>
          </dl>
        </section>
        <section className="panel">
          <h3>Recent tool receipts</h3>
          {state.receipts
            .slice(-8)
            .toReversed()
            .map((receipt) => (
              <div className="list-row" key={receipt.id}>
                <div>
                  <strong>{receipt.tool}</strong>
                  <small>
                    {receipt.actorId} · {receipt.mode}
                  </small>
                </div>
                <Badge>{receipt.status}</Badge>
              </div>
            ))}
          {!state.receipts.length && (
            <p className="muted">No tool calls recorded.</p>
          )}
        </section>
      </div>
      <EntityBudgets
        entities={state.entities}
        dispatch={dispatch}
        busy={busy}
      />
    </>
  );
}

function BudgetControls({
  state,
  dispatch,
  busy,
}: {
  state: WorldState;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const [allowance, setAllowance] = useState(String(state.budget.dailyUsd));

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void dispatch({
          type: "budget.configure",
          dailyUsd: Number(allowance),
        });
      }}
    >
      <label htmlFor="daily-allowance">Daily allowance (USD)</label>
      <input
        type="number"
        id="daily-allowance"
        min="0"
        max="1000"
        step="0.01"
        required
        value={allowance}
        onChange={(event) => setAllowance(event.target.value)}
      />
      <p className="muted">
        An allowance change does not change the environment mode.
      </p>
      <button className="button" type="submit" disabled={busy}>
        Save allowance
      </button>
    </form>
  );
}

function EntityBudgets({
  entities,
  dispatch,
  busy,
}: {
  entities: Entity[];
  dispatch: Dispatch;
  busy: boolean;
}) {
  return (
    <section className="activity-section">
      <SectionHeading title="Individual resource allowances" />
      <p className="muted">
        Each entity has an independent daily cap. Paid work requires room under
        both its cap and the global allowance. Saving a cap does not activate
        live mode.
      </p>
      <div className="entity-grid">
        {entities.map((entity) => (
          <EntityBudget
            key={entity.id}
            entity={entity}
            dispatch={dispatch}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

function EntityBudget({
  entity,
  dispatch,
  busy,
}: {
  entity: Entity;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const [allowance, setAllowance] = useState(
    String(entity.dailyAllowanceUsd ?? 0),
  );

  return (
    <form
      className="panel inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void dispatch({
          type: "budget.entity.configure",
          entityId: entity.id,
          dailyUsd: Number(allowance),
        });
      }}
    >
      <h3>{entity.name}</h3>
      <p className="muted">
        Current cap: ${(entity.dailyAllowanceUsd ?? 0).toFixed(2)} / day
      </p>
      <label htmlFor={`cap-${entity.id}`}>{entity.name} daily cap (USD)</label>
      <input
        type="number"
        id={`cap-${entity.id}`}
        min="0"
        max="1000"
        step="0.01"
        required
        value={allowance}
        onChange={(event) => setAllowance(event.target.value)}
      />
      <button className="button" type="submit" disabled={busy}>
        Save {entity.name} cap
      </button>
    </form>
  );
}
