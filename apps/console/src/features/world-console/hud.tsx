import type { WorldState } from "../../../../../packages/contracts/src/index";
import type { Dispatch } from "./types";

const navigation = [
  ["overview", "◈", "Overview"],
  ["entities", "◉", "Team"],
  ["showcase", "▣", "Showcase"],
  ["discussions", "≋", "Discussions"],
  ["evidence", "✓", "Evidence"],
  ["governance", "⚑", "Governance"],
  ["knowledge", "▤", "Knowledge"],
  ["operations", "⌁", "Operations"],
];

type HudProps = {
  isPublic: boolean;
  mode: string | undefined;
  state: WorldState | null;
  busy: boolean;
  dispatch: Dispatch;
  hudHidden: boolean;
  setHudHidden: (value: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (value: boolean) => void;
  openPanel: (page: string) => void;
};

export function GameHud({
  isPublic,
  mode,
  state,
  busy,
  dispatch,
  hudHidden,
  setHudHidden,
  menuOpen,
  setMenuOpen,
  openPanel,
}: HudProps) {
  return (
    <>
      {!hudHidden && (
        <>
          <WorldTop
            isPublic={isPublic}
            mode={mode}
            setHudHidden={setHudHidden}
          />
          <div className="game-world-caption">
            <span>AGENT NETWORK / 001</span>
            <h1>
              Eight agents.{" "}
              <br />One collective.
            </h1>
            <p>
              Trace the work. Inspect each node.
              <br />
              Watch a shared codebase evolve.
            </p>
          </div>
          <WorldDock
            isPublic={isPublic}
            state={state}
            busy={busy}
            dispatch={dispatch}
            openPanel={openPanel}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
          />
        </>
      )}
      {hudHidden && (
        <button
          className="hud-button restore-hud"
          onClick={() => setHudHidden(false)}
        >
          Show controls ◉
        </button>
      )}
      {menuOpen && (
        <nav className="world-menu" aria-label="World panels">
          <div className="world-menu-title">
            Explore the world
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="Close world menu"
            >
              ×
            </button>
          </div>
          {navigation.flatMap(([id, icon, title]) =>
            isPublic &&
            !["overview", "entities", "showcase", "discussions", "governance"].includes(id)
              ? []
              : [
                  <a
                    key={id}
                    href={`#${id}`}
                    onClick={() => {
                      openPanel(id);
                    }}
                  >
                    <span aria-hidden="true">{icon}</span>
                    {title}
                    <span aria-hidden="true">→</span>
                  </a>,
                ],
          )}
          {!isPublic && <a href="/world">↗ Public world</a>}
        </nav>
      )}
    </>
  );
}

function WorldTop({
  isPublic,
  mode,
  setHudHidden,
}: Pick<HudProps, "isPublic" | "mode" | "setHudHidden">) {
  return (
    <header className="game-hud-top">
      <a
        href={isPublic ? "/world" : "/"}
        className="game-wordmark"
        aria-label="Arti world"
      >
        arti<span>WORLD 001</span>
      </a>
      <div className="game-environment">
        <i className="status-dot" />
        <strong>
          {mode === "local-glm" ? "Local GLM agents" : mode === "live" ? "Live environment" : "Simulation environment"}
        </strong>
        <span>
          {mode === "local-glm" ? "Real model calls · local previews" : mode === "live"
            ? "Metered autonomous activity"
            : "No model calls · scripted agents"}
        </span>
      </div>
      <button
        className="hud-button quiet"
        onClick={() => setHudHidden(true)}
        aria-label="Hide controls"
      >
        Hide UI ◌
      </button>
    </header>
  );
}

function WorldDock({
  isPublic,
  state,
  busy,
  dispatch,
  openPanel,
  menuOpen,
  setMenuOpen,
}: Pick<
  HudProps,
  | "isPublic"
  | "state"
  | "busy"
  | "dispatch"
  | "openPanel"
  | "menuOpen"
  | "setMenuOpen"
>) {
  return (
    <div className="game-bottom-dock">
      {!isPublic && (
        <button
          className="hud-button mission-button"
          onClick={() => openPanel("overview")}
        >
          ◈ Ask the team
        </button>
      )}
      {isPublic && (
        <button
          className="hud-button mission-button"
          onClick={() => openPanel("discussions")}
        >
          ≋ Observe conversations
        </button>
      )}
      {!isPublic && state?.mode === "simulation" && !state.localInference && (
        <button
          className="hud-button"
          disabled={busy || state.paused}
          onClick={() => {
            void dispatch({ type: "world.tick" });
          }}
        >
          ▷ Advance simulation
        </button>
      )}
      {!isPublic && state && (
        <button
          className="hud-button"
          disabled={busy}
          onClick={() => {
            void dispatch({ type: "world.pause", paused: !state.paused });
          }}
        >
          {state.paused ? "▶ Resume world" : "Ⅱ Pause world"}
        </button>
      )}
      <button
        className="hud-button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        ⊞ More
      </button>
    </div>
  );
}
