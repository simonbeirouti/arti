import { useState, useSyncExternalStore } from "react";
import type {
  Command,
  PublicWorld,
  WorldState,
} from "../../../../../packages/contracts/src/index";
import type { Catalogue } from "./types";

type Snapshot = {
  state: WorldState | null;
  publicWorld: PublicWorld | null;
  catalogue: Catalogue | null;
  page: string;
  error: string;
  busy: boolean;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(body || `Request failed (${response.status})`);
  }

  return response.json();
}

/** One observable client per mounted world; commands invalidate older polling reads. */
class WorldClient {
  private snapshot: Snapshot = {
    state: null,
    publicWorld: null,
    catalogue: null,
    page: window.location.hash.slice(1) || (window.location.pathname.startsWith("/showcase") ? "showcase" : "overview"),
    error: "",
    busy: false,
  };
  private listeners = new Set<() => void>();
  private interval: number | null = null;
  private sessionReady = false;
  private generation = 0;
  private commandSequence = 0;
  private refreshing = false;

  constructor(private readonly isPublic: boolean) {}

  getSnapshot = (): Snapshot => this.snapshot;

  private update(change: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };

    for (const listener of this.listeners) listener();
  }

  private onHash = (): void =>
    this.update({ page: window.location.hash.slice(1) || "overview" });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    if (this.listeners.size === 1) {
      this.generation += 1;
      this.interval = window.setInterval(() => {
        void this.refresh();
      }, 4000);
      window.addEventListener("hashchange", this.onHash);
      void this.refresh();
    }

    return () => {
      this.listeners.delete(listener);

      if (this.listeners.size === 0) {
        this.generation += 1;

        if (this.interval !== null) window.clearInterval(this.interval);

        this.interval = null;
        window.removeEventListener("hashchange", this.onHash);
      }
    };
  };

  refresh = async (): Promise<void> => {
    if (this.refreshing || this.snapshot.busy) return;

    this.refreshing = true;
    const generation = this.generation;
    const sequence = this.commandSequence;

    try {
      if (this.isPublic) {
        const publicWorld = await request<PublicWorld>("/api/v1/public");

        if (generation === this.generation) this.update({ publicWorld });

        return;
      }

      if (!this.sessionReady) {
        await request("/api/v1/session");
        this.sessionReady = true;
      }

      const state = await request<WorldState>("/api/v1/world");

      if (generation === this.generation && sequence === this.commandSequence)
        this.update({ state });

      if (!this.snapshot.catalogue) {
        const catalogue = await request<Catalogue>("/api/v1/catalog");

        if (generation === this.generation) this.update({ catalogue });
      }
    } catch (cause) {
      if (generation === this.generation)
        this.update({
          error:
            cause instanceof Error ? cause.message : "Unable to load world",
        });
    } finally {
      this.refreshing = false;
    }
  };

  setError = (error: string): void => this.update({ error });

  dispatch = async (command: Command): Promise<boolean> => {
    this.commandSequence += 1;
    this.update({ busy: true, error: "" });

    try {
      const state = await request<WorldState>("/api/v1/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, idempotencyKey: crypto.randomUUID() }),
      });

      this.update({ state });

      return true;
    } catch (cause) {
      this.update({
        error: cause instanceof Error ? cause.message : "Action failed",
      });

      return false;
    } finally {
      this.commandSequence += 1;
      this.update({ busy: false });
    }
  };
}

export function useWorld(isPublic: boolean) {
  const [client] = useState(() => new WorldClient(isPublic));
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);

  return { ...snapshot, dispatch: client.dispatch, setError: client.setError, refresh: client.refresh };
}
