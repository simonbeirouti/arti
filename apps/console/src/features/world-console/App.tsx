import { SharedWebsite } from "../shared-website/SharedWebsite";
import { GameHud } from "./hud";
import { useState } from "react";
import { EmptyState } from "../../../../../packages/ui/src/index";
import { readable } from "./view-model";
import { WorldPages } from "./pages";
import { WorldScene } from "./scene";
import { useWorld } from "./use-world";

export function App() {
  if (["/world", "/showcase"].some(path => window.location.pathname.startsWith(path))) return <SharedWebsite />;

  return <OperatorApp />;
}

function OperatorApp() {
  const isPublic = ["/world", "/showcase"].some(path => window.location.pathname.startsWith(path));

  const {
    state,
    publicWorld,
    catalogue,
    page,
    error,
    busy,
    dispatch,
    setError,
    refresh,
  } = useWorld(isPublic);

  const [panelOpen, setPanelOpen] = useState(() => window.location.pathname.startsWith("/showcase"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const data = isPublic ? publicWorld : state;
  const projectExpanded = panelOpen && page === "showcase" && !hudHidden;

  const entityName = (id: string) =>
    data?.entities.find((entity) => entity.id === id)?.name ?? id;

  const openPanel = (nextPage: string) => {
    window.location.hash = nextPage;
    setPanelOpen(true);
    setMenuOpen(false);
  };

  return (
    <main
      className={`world-game ${projectExpanded ? "project-expanded" : ""} ${hudHidden ? "controls-hidden" : ""}`}
      id="main"
    >
      {data ? (
        <WorldScene
          data={data}
          isPublic={isPublic}
          state={state}
          onObserve={() => openPanel("discussions")}
          onProject={() => openPanel("showcase")}
        />
      ) : (
        <div className="world-connecting">
          <EmptyState title="Entering Arti">
            Connecting to the persistent world…
          </EmptyState>
        </div>
      )}
      <GameHud
        isPublic={isPublic}
        mode={data?.localInference ? "local-glm" : data?.mode}
        state={state}
        busy={busy}
        dispatch={dispatch}
        hudHidden={hudHidden}
        setHudHidden={setHudHidden}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        openPanel={openPanel}
      />
      {error && (
        <div className="game-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {panelOpen && data && (
        <section
          className="world-overlay"
          aria-label={`${readable(page)} panel`}
        >
          <header className="overlay-heading">
            <div>
              <p className="eyebrow">
                {isPublic ? "Public world" : "Operator controls"}
              </p>
              <h2>
                {page === "overview"
                  ? isPublic
                    ? "World overview"
                    : "Shared goal"
                  : readable(page).replace(/^./, (letter) =>
                      letter.toUpperCase(),
                    )}
              </h2>
            </div>
            <button
              className="overlay-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
            >
              ×
            </button>
          </header>
          <div className="overlay-content">
            <WorldPages
              data={data}
              state={state}
              publicWorld={publicWorld}
              catalogue={catalogue}
              isPublic={isPublic}
              page={page}
              dispatch={dispatch}
              busy={busy}
              entityName={entityName}
              refresh={refresh}
            />
          </div>
        </section>
      )}
    </main>
  );
}
