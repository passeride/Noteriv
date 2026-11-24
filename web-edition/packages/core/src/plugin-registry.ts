/**
 * Core-plugin registry: which plugins exist, which are enabled, and the load/unload lifecycle.
 *
 * Platform- and UI-neutral on purpose. It does not know what an `Api` is: the app (via @noteriv/ui) supplies
 * `createContext`, which builds the API object a plugin receives together with a `dispose` that removes everything
 * the plugin registered through it. The registry guarantees that `dispose` runs on disable and on a failed load, so a
 * plugin can never leave commands or status items behind.
 *
 * `load()` is a dynamic import in the app, which is what keeps a disabled plugin's code out of the initial bundle.
 */

export interface CorePluginModule<Api> {
  onload(api: Api): void | Promise<void>;
  onunload?(): void | Promise<void>;
}

export interface CorePluginDef<Api> {
  /** Stable id, also the key in the stored state. */
  id: string;
  /** Shown in Settings. Optional: the apps take it from their i18n catalog by id (core has no catalog). */
  name?: string;
  description?: string;
  /** Used until the user chooses; absent means off. */
  defaultEnabled?: boolean;
  /** Dynamic import of the plugin module (default export, or the module itself). */
  load(): Promise<{ default: CorePluginModule<Api> } | CorePluginModule<Api>>;
}

/** Where on/off choices persist. Web: vault settings. Desktop: `.noteriv/plugin-config.json`. */
export interface PluginStateStore {
  load(): Promise<Record<string, boolean>>;
  save(state: Record<string, boolean>): Promise<void>;
}

export interface PluginContext<Api> {
  api: Api;
  /** Remove everything registered through `api`. Must be idempotent. */
  dispose(): void;
}

export type CorePluginStatus = "disabled" | "loading" | "enabled" | "error";

export interface CorePluginInfo {
  id: string;
  name?: string;
  description?: string;
  /** What the user (or default) asked for. `status` says whether it is actually running. */
  enabled: boolean;
  status: CorePluginStatus;
  /** Technical detail of the last failure (the error's own message), for the UI to show after its own text. */
  error?: string;
  /** What failed: loading the plugin, or saving the on/off choice (the plugin may still be running). */
  errorKind?: CorePluginErrorKind;
}

export type CorePluginErrorKind = "load" | "save";

export interface PluginRegistryOptions<Api> {
  plugins: CorePluginDef<Api>[];
  store: PluginStateStore;
  createContext(pluginId: string): PluginContext<Api>;
}

interface Running<Api> {
  module: CorePluginModule<Api>;
  context: PluginContext<Api>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isModule<Api>(m: unknown): m is CorePluginModule<Api> {
  return typeof m === "object" && m !== null && typeof (m as CorePluginModule<Api>).onload === "function";
}

export class PluginRegistry<Api> {
  private readonly defs = new Map<string, CorePluginDef<Api>>();
  private readonly running = new Map<string, Running<Api>>();
  private readonly status = new Map<string, { status: CorePluginStatus; error?: string; errorKind?: CorePluginErrorKind }>();
  private readonly listeners = new Set<() => void>();
  private state: Record<string, boolean> = {};
  private snapshot: CorePluginInfo[] = [];
  /** Operations run one after another so a quick enable-then-disable cannot interleave. */
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: PluginRegistryOptions<Api>) {
    for (const def of options.plugins) {
      if (this.defs.has(def.id)) throw new Error(`Duplicate core plugin id: ${def.id}`);
      this.defs.set(def.id, def);
      this.status.set(def.id, { status: "disabled" });
    }
    this.rebuild();
  }

  /** Read the stored state and start every enabled plugin. Failures are per plugin and never throw. */
  init(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.state = (await this.options.store.load()) ?? {};
      } catch {
        this.state = {};
      }
      for (const def of this.defs.values()) {
        if (this.isEnabled(def.id)) await this.start(def.id);
      }
    });
  }

  /** Stable between changes, so it is safe as a React `useSyncExternalStore` snapshot. */
  list(): CorePluginInfo[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Persist the choice, then start or stop the plugin. Resolves once the plugin reached its new status. */
  setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.defs.has(id)) return Promise.reject(new Error(`Unknown core plugin: ${id}`));
    return this.enqueue(async () => {
      this.state = { ...this.state, [id]: enabled };
      let saveError: string | undefined;
      try {
        await this.options.store.save(this.state);
      } catch (err) {
        saveError = errorMessage(err);
      }
      if (enabled) await this.start(id);
      else await this.stop(id);
      // Keep running with the in-memory choice, but let the UI say the choice may not stick.
      const after = this.status.get(id)!;
      if (saveError && !after.error) this.setStatus(id, after.status, saveError, "save");
    });
  }

  /**
   * Applies an on/off change already saved elsewhere (another browser tab on the same vault): starts or stops the
   * plugin without writing the stored state again.
   */
  applyExternalChange(id: string, enabled: boolean): Promise<void> {
    if (!this.defs.has(id)) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.state[id] === enabled) return;
      this.state = { ...this.state, [id]: enabled };
      if (enabled) await this.start(id);
      else await this.stop(id);
    });
  }

  /** Stop and start again every running plugin (e.g. after a language change, so text set in onload follows). */
  restartRunning(): Promise<void> {
    return this.enqueue(async () => {
      for (const id of Array.from(this.running.keys())) {
        await this.stop(id);
        await this.start(id);
      }
    });
  }

  /** Stop everything (vault closed or page unmounted). Does not touch the stored state. */
  dispose(): Promise<void> {
    return this.enqueue(async () => {
      this.disposed = true;
      for (const id of Array.from(this.running.keys())) await this.stop(id);
      this.listeners.clear();
    });
  }

  private isEnabled(id: string): boolean {
    const chosen = this.state[id];
    return typeof chosen === "boolean" ? chosen : this.defs.get(id)?.defaultEnabled === true;
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private setStatus(id: string, status: CorePluginStatus, error?: string, errorKind?: CorePluginErrorKind) {
    this.status.set(id, { status, error, errorKind: error ? errorKind : undefined });
    this.rebuild();
  }

  private rebuild() {
    this.snapshot = Array.from(this.defs.values()).map((def) => {
      const s = this.status.get(def.id)!;
      return {
        id: def.id,
        ...(def.name !== undefined ? { name: def.name } : {}),
        ...(def.description !== undefined ? { description: def.description } : {}),
        enabled: this.isEnabled(def.id),
        status: s.status,
        ...(s.error ? { error: s.error, errorKind: s.errorKind } : {}),
      };
    });
    if (this.disposed) return;
    for (const l of Array.from(this.listeners)) l();
  }

  private async start(id: string): Promise<void> {
    if (this.running.has(id) || this.disposed) {
      this.rebuild();
      return;
    }
    const def = this.defs.get(id)!;
    this.setStatus(id, "loading");
    let context: PluginContext<Api> | null = null;
    try {
      const loaded = await def.load();
      const module = "default" in loaded && isModule<Api>(loaded.default) ? loaded.default : loaded;
      if (!isModule<Api>(module)) throw new Error("Module has no onload()");
      context = this.options.createContext(id);
      await module.onload(context.api);
      this.running.set(id, { module, context });
      this.setStatus(id, "enabled");
    } catch (err) {
      try {
        context?.dispose();
      } catch {
        /* nothing more to do */
      }
      this.setStatus(id, "error", errorMessage(err), "load");
    }
  }

  private async stop(id: string): Promise<void> {
    const run = this.running.get(id);
    this.running.delete(id);
    if (run) {
      try {
        await run.module.onunload?.();
      } catch {
        /* a failing onunload must not keep the plugin's registrations alive */
      }
      try {
        run.context.dispose();
      } catch {
        /* idempotent best effort */
      }
    }
    this.setStatus(id, "disabled");
  }
}
