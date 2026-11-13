import { useState } from "react";
import type {
  Task,
  WorldState,
} from "../../../../../packages/contracts/src/index";
import { Badge, SectionHeading } from "../../../../../packages/ui/src/index";
import { currentGoal, lines } from "./view-model";
import type { Dispatch } from "./types";

export function ReviewInbox({
  state,
  dispatch,
  busy,
}: {
  state: WorldState;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const goal = currentGoal(state);

  const submitted = state.tasks.filter(
    (task) =>
      task.goalId === goal?.id &&
      task.revision === goal.revision &&
      task.status === "submitted",
  );

  if (!submitted.length) return null;

  return (
    <section className="review-inbox">
      <SectionHeading title="Work awaiting your review">
        <Badge tone="amber">{submitted.length} submissions</Badge>
      </SectionHeading>
      <p className="muted">
        Review saved outcomes independently. Task approval and criterion
        verification are separate from final goal acceptance.
      </p>
      <div className="stack">
        {submitted.map((task) => (
          <TaskReview
            key={task.id}
            task={task}
            dispatch={dispatch}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

function TaskReview({
  task,
  dispatch,
  busy,
}: {
  task: Task;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [approved, setApproved] = useState("approve");

  return (
    <form
      className="panel goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        void dispatch({
          type: "task.review",
          taskId: task.id,
          expectedRevision: task.revision,
          approved: approved === "approve",
          feedback,
        });
      }}
    >
      <Badge>{task.entityId}</Badge>
      <h3>{task.title}</h3>
      <label htmlFor={`decision-${task.id}`}>Review decision</label>
      <select
        id={`decision-${task.id}`}
        value={approved}
        onChange={(event) => setApproved(event.target.value)}
      >
        <option value="approve">Approve independently reviewed work</option>
        <option value="reject">Return for changes</option>
      </select>
      <label htmlFor={`feedback-${task.id}`}>Review findings</label>
      <textarea
        id={`feedback-${task.id}`}
        minLength={5}
        maxLength={2000}
        required
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="What saved results did you inspect?"
      />
      <button className="button" type="submit" disabled={busy}>
        Record task review
      </button>
    </form>
  );
}

export function CriterionVerification({
  state,
  dispatch,
  busy,
}: {
  state: WorldState;
  dispatch: Dispatch;
  busy: boolean;
}) {
  const goal = currentGoal(state);
  const [criterionIndex, setCriterionIndex] = useState(0);
  const [deploymentId, setDeploymentId] = useState("");
  const [assertions, setAssertions] = useState("");

  if (state.mode !== "live" && !state.localInference || goal?.status !== "active") return null;

  const revision = goal.revisions.find(
    (item) => item.revision === goal.revision,
  );

  const deployments = state.deployments.filter(
    (item) =>
      item.goalId === goal.id &&
      item.revision === goal.revision &&
      (state.localInference ? item.environment === "simulation" && item.authorship === "agent" : item.environment !== "simulation") &&
      item.status === "published",
  );

  return (
    <section className="panel">
      <SectionHeading title="Verify an acceptance criterion" />
      <p className="muted">
        Inspect the deployed result and its saved data, then record the
        assertions you independently checked. An agent statement is insufficient
        evidence.
      </p>
      {deployments.length ? (
        <form
          className="goal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void dispatch({
              type: "goal.verify",
              goalId: goal.id,
              expectedRevision: goal.revision,
              criterionIndex,
              deploymentId,
              assertions: lines(assertions),
            });
          }}
        >
          <label htmlFor="verify-criterion">Acceptance criterion</label>
          <select
            id="verify-criterion"
            value={criterionIndex}
            onChange={(event) => setCriterionIndex(Number(event.target.value))}
          >
            {revision?.criteria.map((criterion, index) => (
              <option key={criterion} value={index}>
                {criterion}
              </option>
            ))}
          </select>
          <label htmlFor="verify-deployment">Checked deployment</label>
          <select
            id="verify-deployment"
            required
            value={deploymentId}
            onChange={(event) => setDeploymentId(event.target.value)}
          >
            <option value="">Choose a current checked preview or deployment</option>
            {deployments.map((deployment) => (
              <option key={deployment.id} value={deployment.id}>
                {deployment.entityId} · {deployment.environment} · v
                {deployment.version} · {deployment.commit.slice(0, 10)}
              </option>
            ))}
          </select>
          <label htmlFor="verify-assertions">
            Verified assertions <small>One saved outcome per line</small>
          </label>
          <textarea
            id="verify-assertions"
            required
            minLength={5}
            value={assertions}
            onChange={(event) => setAssertions(event.target.value)}
          />
          <button
            className="button primary"
            type="submit"
            disabled={busy || state.paused}
          >
            Record criterion verification
          </button>
        </form>
      ) : (
        <p className="muted">
          {state.localInference ? "A generated local preview is required before verification." : "A current checked staging or production deployment is required before verification."}
        </p>
      )}
    </section>
  );
}
