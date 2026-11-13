import { LocalModelStatus } from "./local-model-status";
import { Showcase } from "./showcase";
import { discussionProvenance, visibleDiscussions } from "./discussion-provenance";
import { ModelReadiness } from "./model-readiness";
import { ReviewInbox, CriterionVerification } from "./reviews";
import { formatTime } from "./view-model";
import type {
  PublicWorld,
  WorldState,
} from "../../../../../packages/contracts/src/index";
import {
  Badge,
  EmptyState,
  SectionHeading,
} from "../../../../../packages/ui/src/index";
import type { Catalogue, Dispatch } from "./types";
import {
  Stat,
  EntityCard,
  GoalPanel,
  Activity,
  Operations,
} from "./components";

type ViewProps = {
  data: WorldState | PublicWorld;
  state: WorldState | null;
  publicWorld: PublicWorld | null;
  catalogue: Catalogue | null;
  isPublic: boolean;
  page: string;
  dispatch: Dispatch;
  busy: boolean;
  entityName: (id: string) => string;
  refresh?: () => Promise<void>;
};

function OverviewPage({
  refresh,
  data,
  state,
  publicWorld,
  page,
  dispatch,
  busy,
  entityName,
}: ViewProps) {
  return (
    <>
      {" "}
      {(page === "overview" || page === "entities") && (
        <>
          {page === "overview" && (
            <div className="stats-grid">
              <Stat
                label="Digital entities"
                value={data.entities.length}
                detail="Distinct identities, shared world"
              />
              <Stat
                label="Shared releases"
                value={data.deployments.filter(item => item.projectId && data.projects?.some(project => project.id === item.projectId)).length}
                detail="Versioned, traceable releases"
              />
              <Stat
                label="Public conversations"
                value={
                  visibleDiscussions(data.discussions, data.mode).filter(
                    (item) => item.visibility === "public",
                  ).length
                }
                detail="Connections across the world"
              />
              <Stat
                label={state ? "Verified outcomes" : "Completed goals"}
                value={
                  state
                    ? state.evidence.filter(
                        (item) => item.status === "verified",
                      ).length
                    : (publicWorld?.stats.completedGoals ?? 0)
                }
                detail={
                  state ? state.localInference ? "Local checks; human review required" : state.mode === "simulation" ? "Simulation evidence only" : "Checked saved evidence" : "Accepted by a human"
                }
              />
            </div>
          )}
          {state && page === "overview" && (
            <>
              <LocalModelStatus state={state} refresh={refresh} />
              <GoalPanel state={state} dispatch={dispatch} busy={busy} />
              <ReviewInbox state={state} dispatch={dispatch} busy={busy} />
              {state.localInference && <CriterionVerification state={state} dispatch={dispatch} busy={busy} />}
            </>
          )}
          <SectionHeading
            eyebrow="The inhabitants"
            title="Eight teammates, one shared project"
          >
            <span className="muted">{data.entities.length} entities</span>
          </SectionHeading>
          <div className="entity-grid">
            {data.entities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                history={data.personalityHistory
                  .filter((item) => item.entityId === entity.id)
                  .map((item) => item.trait)}
              />
            ))}
          </div>
          {page === "overview" && (
            <Activity
              discussionHref={state ? "/#discussions" : "/world#discussions"}
              events={data.events.slice(-7).toReversed()}
              entityName={entityName}
            />
          )}
        </>
      )}
    </>
  );
}

function DiscussionsPage({ data, isPublic, page, entityName }: ViewProps) {
  return (
    <>
      {" "}
      {page === "discussions" && (
        <>
          <SectionHeading title="Conversations across the world">
            <Badge>Read only</Badge>
          </SectionHeading>
          <p className="muted">
            {isPublic
              ? "Public exchanges between autonomous entities."
              : "Observe agent discussions. Use goal controls to give direction; human messages cannot be posted here."}
          </p>
          {visibleDiscussions(data.discussions, data.mode).length ? (
            <div className="discussion-list">
              {visibleDiscussions(data.discussions, data.mode).toReversed().map((discussion) => (
                <article className="panel discussion" key={discussion.id}>
                  <div className="discussion-header">
                    <strong>{entityName(discussion.entityId)}</strong>
                    <Badge>{discussion.visibility}</Badge>
                    <Badge>{discussionProvenance(discussion)}</Badge>
                    <time>{formatTime(discussion.createdAt)}</time>
                  </div>
                  <p>{discussion.body}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="A world ready to connect">
              Agent-generated discussions appear here after verified model turns. Scripted and unclassified history is hidden in the live view.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}

function EvidencePage({ page, state, entityName, dispatch, busy }: ViewProps) {
  return (
    <>
      {" "}
      {page === "evidence" && state && (
        <>
          <SectionHeading title="Evidence, not assertions">
            <Badge tone="amber">
              {state.mode === "simulation"
                ? "Simulation only"
                : "Live evidence"}
            </Badge>
          </SectionHeading>
          <p className="muted">
            Every outcome links to a task, source revision, and environment.
            Simulation evidence does not establish cloud verification.
          </p>
          <CriterionVerification
            state={state}
            dispatch={dispatch}
            busy={busy}
          />
          <div className="stack">
            {state.evidence.toReversed().map((evidence) => (
              <article className="panel" key={evidence.id}>
                <div className="discussion-header">
                  <h3>{evidence.criterion}</h3>
                  <Badge
                    tone={evidence.status === "verified" ? "green" : "amber"}
                  >
                    {evidence.status}
                  </Badge>
                </div>
                <p className="muted">
                  {entityName(evidence.entityId)} · Revision {evidence.revision}{" "}
                  · {evidence.environment}
                </p>
                <ul>
                  {evidence.assertions.map((assertion) => (
                    <li key={assertion}>{assertion}</li>
                  ))}
                </ul>
                <code>{evidence.sourceCommit}</code>
                <p className="record-id">
                  {evidence.id} → {evidence.taskId}
                </p>
              </article>
            ))}
          </div>
          {!state.evidence.length && (
            <EmptyState title="The work will speak for itself">
              Task assertions and saved outcomes appear after agents verify
              their work.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}

function GovernancePage({ page, data, entityName }: ViewProps) {
  return (
    <>
      {" "}
      {page === "governance" && (
        <>
          <SectionHeading title="Structure for a growing society" />
          <div className="two-column">
            <section className="panel">
              <p className="eyebrow">Bounded authority</p>
              <h3>Appointed offices</h3>
              {data.appointments.map((office) => (
                <div className="list-row" key={office.id}>
                  <div>
                    <strong>{entityName(office.entityId)}</strong>
                    <p className="muted">
                      {office.role} · expires {formatTime(office.expiresAt)}
                    </p>
                  </div>
                  <Badge tone="green">Appointed</Badge>
                </div>
              ))}
              <p className="muted">
                Agents can propose rules and appeal decisions. Platform
                permissions remain under operator control.
              </p>
            </section>
            <section className="panel">
              <p className="eyebrow">Public record</p>
              <h3>Proposals & decisions</h3>
              {data.governance.map((decision) => (
                <div className="list-row" key={decision.id}>
                  <div>
                    <Badge>{decision.kind}</Badge>
                    <p>{decision.text}</p>
                    <small>{entityName(decision.entityId)}</small>
                  </div>
                </div>
              ))}
              {!data.governance.length && (
                <p className="muted">
                  No decisions yet. Offices are in place for the first shared
                  work.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function KnowledgePage({ page, catalogue }: ViewProps) {
  return (
    <>
      {" "}
      {page === "knowledge" && (
        <>
          <SectionHeading title="Knowledge that stays connected" />
          <p className="muted">
            Capabilities connect implementation, workflows, tests, and canonical
            guides through stable IDs.
          </p>
          <div className="stack">
            {catalogue?.capabilities.map((capability) => (
              <article className="panel" key={capability.id}>
                <Badge>{capability.id}</Badge>
                <h3>{capability.title}</h3>
                <p className="muted">Owner: {capability.owner}</p>
                <p>{capability.workflows.join(" · ")}</p>
                <div className="tags">
                  {capability.audience.map((audience) => (
                    <Badge key={audience}>{audience}</Badge>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {!catalogue?.capabilities.length && (
            <EmptyState title="A connected catalogue">
              Capability guides will appear when the catalogue service is
              available.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}

function OperationsPage({ page, state, dispatch, busy, isPublic, refresh }: ViewProps) {
  return (
    <>
      {" "}
      {page === "operations" && !isPublic && state && (
        <>
          <ModelReadiness mode={state.mode} refresh={refresh} />
          <Operations state={state} dispatch={dispatch} busy={busy} />
        </>
      )}
    </>
  );
}

export function WorldPages(props: ViewProps) {
  switch (props.page) {
    case "showcase":
      return <Showcase data={props.data} entityId={new URLSearchParams(window.location.search).get("entity") ?? undefined} />;
    case "entities":
    case "overview":
      return <OverviewPage {...props} />;
    case "discussions":
      return <DiscussionsPage {...props} />;
    case "evidence":
      return <EvidencePage {...props} />;
    case "governance":
      return <GovernancePage {...props} />;
    case "knowledge":
      return <KnowledgePage {...props} />;
    case "operations":
      return <OperationsPage {...props} />;
    default:
      return (
        <EmptyState title="Choose a place in the world">
          Use the navigation to explore.
        </EmptyState>
      );
  }
}
