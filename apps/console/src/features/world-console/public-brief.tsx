import { useState, type FormEvent } from "react";
import type { Goal } from "../../../../../packages/contracts/src/index";
import type { Dispatch } from "./types";
import { formatTime } from "./view-model";

/** The textarea is never initialized from private goal or task text. */
export function PublicBrief({
  goal,
  dispatch,
  busy,
}: {
  goal: Goal;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const revision = goal.revisions.find(
    (item) => item.revision === goal.revision,
  );

  const approved = revision?.publicBrief;
  const permitted = ["draft", "active", "paused"].includes(goal.status);

  if (approved)
    return (
      <section
        className="public-brief-panel"
        aria-label="Approved public authoring brief"
      >
        <p className="eyebrow">
          Public authoring · approved for revision {goal.revision}
        </p>
        <h3>Approved public brief</h3>
        <blockquote>{approved.text}</blockquote>
        <p className="muted">
          Approved {formatTime(approved.approvedAt)}. This text may be
          published. Change direction to create a new revision if the brief
          needs to change.
        </p>
      </section>
    );

  if (!permitted)
    return (
      <section
        className="public-brief-panel"
        aria-label="Public authoring brief unavailable"
      >
        <h3>Public authoring brief</h3>
        <p className="muted">
          Public authoring has no approved brief for this revision. Approval is
          available while the goal is draft, active or paused.
        </p>
      </section>
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!acknowledged || text.trim().length < 10 || busy) return;
    void dispatch({
      type: "goal.public_brief",
      goalId: goal.id,
      expectedRevision: goal.revision,
      text: text.trim(),
      acknowledgement: "APPROVE_PUBLIC_AUTHORING",
    });
  };

  return (
    <section
      className="public-brief-panel"
      aria-label="Approve public authoring"
    >
      <p className="eyebrow">Separate permission · revision {goal.revision}</p>
      <h3>Public authoring brief</h3>
      <p className="muted">
        Write the exact instructions approved for public authoring. This text
        may be published. Only this approved text is passed to the public
        authoring agent; the private objective, tasks and reports are excluded.
      </p>
      <form className="goal-form public-brief-form" onSubmit={submit}>
        <label htmlFor="public-authoring-brief">Public-safe brief</label>
        <textarea
          id="public-authoring-brief"
          rows={4}
          maxLength={4000}
          minLength={10}
          required
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setAcknowledged(false);
          }}
          placeholder="Write a separate brief suitable for public use"
          disabled={busy}
        />
        <label className="public-brief-confirmation">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            disabled={busy}
          />
          I approve this exact text for public authoring and publication.
        </label>
        <button
          className="button"
          type="submit"
          disabled={busy || !acknowledged || text.trim().length < 10}
        >
          Approve public authoring brief
        </button>
        <p className="muted">
          Approval is recorded once per goal revision. Starting a goal does not
          grant this permission.
        </p>
      </form>
    </section>
  );
}
