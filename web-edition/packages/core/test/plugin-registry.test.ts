import { describe, expect, it, vi } from "vitest";
import {
  PluginRegistry,
  type CorePluginDef,
  type CorePluginModule,
  type PluginContext,
  type PluginStateStore,
} from "../src/plugin-registry";

type Api = { registered: string[] };

function memoryStore(initial: Record<string, boolean> = {}) {
  let state = { ...initial };
  const store: PluginStateStore & { saved: Record<string, boolean>[] } = {
    saved: [],
    load: async () => ({ ...state }),
    save: async (s) => {
      state = { ...s };
      store.saved.push({ ...s });
    },
  };
  return store;
}

function setup(defs: CorePluginDef<Api>[], store: PluginStateStore = memoryStore()) {
  const disposed: string[] = [];
  const registry = new PluginRegistry<Api>({
    plugins: defs,
    store,
    createContext: (id): PluginContext<Api> => {
      const api: Api = { registered: [] };
      return { api, dispose: () => disposed.push(id) };
    },
  });
  return { registry, disposed };
}

function plugin(id: string, mod: Partial<CorePluginModule<Api>> = {}, extra: Partial<CorePluginDef<Api>> = {}): CorePluginDef<Api> {
  return {
    id,
    name: id,
    description: `${id} plugin`,
    load: async () => ({ default: { onload: () => undefined, ...mod } }),
    ...extra,
  };
}

describe("PluginRegistry", () => {
  it("applies a change made in another tab without saving it again", async () => {
    const onload = vi.fn();
    const store = memoryStore();
    const { registry, disposed } = setup([plugin("a", { onload })], store);
    await registry.init();
    await registry.applyExternalChange("a", true);
    expect(onload).toHaveBeenCalledOnce();
    expect(registry.list()[0].enabled).toBe(true);
    await registry.applyExternalChange("a", true); // repeated message: no second start
    expect(onload).toHaveBeenCalledOnce();
    await registry.applyExternalChange("a", false);
    expect(disposed).toEqual(["a"]);
    await registry.applyExternalChange("unknown", true); // ignored, no throw
    expect(store.saved).toEqual([]);
  });

  it("lists plugins as disabled until initialised", () => {
    const { registry } = setup([plugin("a"), plugin("b")]);
    expect(registry.list().map((p) => [p.id, p.enabled, p.status])).toEqual([
      ["a", false, "disabled"],
      ["b", false, "disabled"],
    ]);
  });

  it("starts plugins that are enabled by default or by stored choice, and not the rest", async () => {
    const onloadA = vi.fn();
    const onloadB = vi.fn();
    const onloadC = vi.fn();
    const { registry } = setup(
      [plugin("a", { onload: onloadA }, { defaultEnabled: true }), plugin("b", { onload: onloadB }), plugin("c", { onload: onloadC }, { defaultEnabled: true })],
      memoryStore({ b: true, c: false })
    );
    await registry.init();
    expect(onloadA).toHaveBeenCalledOnce();
    expect(onloadB).toHaveBeenCalledOnce();
    expect(onloadC).not.toHaveBeenCalled();
    expect(registry.list().map((p) => [p.id, p.status])).toEqual([
      ["a", "enabled"],
      ["b", "enabled"],
      ["c", "disabled"],
    ]);
  });

  it("does not import the module of a disabled plugin", async () => {
    const load = vi.fn(async () => ({ default: { onload: () => undefined } }));
    const { registry } = setup([{ id: "lazy", name: "lazy", description: "", load }]);
    await registry.init();
    expect(load).not.toHaveBeenCalled();
    await registry.setEnabled("lazy", true);
    expect(load).toHaveBeenCalledOnce();
  });

  it("accepts a module without a default export", async () => {
    const onload = vi.fn();
    const { registry } = setup([{ id: "flat", name: "flat", description: "", load: async () => ({ onload }) }]);
    await registry.setEnabled("flat", true);
    expect(onload).toHaveBeenCalledOnce();
    expect(registry.list()[0].status).toBe("enabled");
  });

  it("persists the choice and starts the plugin on enable", async () => {
    const store = memoryStore();
    const onload = vi.fn();
    const { registry } = setup([plugin("a", { onload })], store);
    await registry.init();
    await registry.setEnabled("a", true);
    expect(store.saved.at(-1)).toEqual({ a: true });
    expect(onload).toHaveBeenCalledOnce();
    expect(registry.list()[0]).toMatchObject({ enabled: true, status: "enabled" });
  });

  it("on disable calls onunload, then disposes what the plugin registered", async () => {
    const order: string[] = [];
    const { registry, disposed } = setup([plugin("a", { onunload: () => void order.push("onunload") })]);
    const unsubscribe = registry.subscribe(() => undefined);
    await registry.setEnabled("a", true);
    await registry.setEnabled("a", false);
    expect(order).toEqual(["onunload"]);
    expect(disposed).toEqual(["a"]);
    expect(registry.list()[0]).toMatchObject({ enabled: false, status: "disabled" });
    unsubscribe();
  });

  it("still disposes registrations when onunload throws", async () => {
    const { registry, disposed } = setup([
      plugin("a", {
        onunload: () => {
          throw new Error("boom");
        },
      }),
    ]);
    await registry.setEnabled("a", true);
    await registry.setEnabled("a", false);
    expect(disposed).toEqual(["a"]);
    expect(registry.list()[0].status).toBe("disabled");
  });

  it("reports a plugin whose onload throws as an error and disposes it, without affecting others", async () => {
    const good = vi.fn();
    const { registry, disposed } = setup(
      [
        plugin("bad", {
          onload: () => {
            throw new Error("nope");
          },
        }),
        plugin("good", { onload: good }),
      ],
      memoryStore({ bad: true, good: true })
    );
    await registry.init();
    expect(registry.list().map((p) => [p.id, p.status])).toEqual([
      ["bad", "error"],
      ["good", "enabled"],
    ]);
    expect(registry.list()[0].error).toBe("nope");
    expect(disposed).toEqual(["bad"]);
    expect(good).toHaveBeenCalledOnce();
  });

  it("reports a plugin whose import fails or whose module has no onload", async () => {
    const { registry } = setup(
      [
        { id: "x", name: "x", description: "", load: async () => Promise.reject(new Error("chunk failed")) },
        { id: "y", name: "y", description: "", load: async () => ({ default: {} as never }) },
      ],
      memoryStore({ x: true, y: true })
    );
    await registry.init();
    expect(registry.list()[0]).toMatchObject({ status: "error", error: "chunk failed", errorKind: "load" });
    expect(registry.list()[1]).toMatchObject({ status: "error", error: "Module has no onload()", errorKind: "load" });
  });

  it("serialises a quick enable then disable so the plugin ends up stopped and disposed once", async () => {
    let finishLoad!: () => void;
    const gate = new Promise<void>((r) => (finishLoad = r));
    const { registry, disposed } = setup([
      {
        id: "slow",
        name: "slow",
        description: "",
        load: async () => {
          await gate;
          return { default: { onload: () => undefined } };
        },
      },
    ]);
    const enabling = registry.setEnabled("slow", true);
    const disabling = registry.setEnabled("slow", false);
    finishLoad();
    await Promise.all([enabling, disabling]);
    expect(registry.list()[0]).toMatchObject({ enabled: false, status: "disabled" });
    expect(disposed).toEqual(["slow"]);
  });

  it("keeps working when the store cannot load or save, and says the choice may not stick", async () => {
    const store: PluginStateStore = {
      load: async () => Promise.reject(new Error("offline")),
      save: async () => Promise.reject(new Error("offline")),
    };
    const { registry } = setup([plugin("a", {}, { defaultEnabled: true }), plugin("b")], store);
    await registry.init();
    expect(registry.list()[0].status).toBe("enabled");
    await registry.setEnabled("b", true);
    expect(registry.list()[1]).toMatchObject({ status: "enabled" });
    // The UI says "could not save" in the user's language; the registry only gives the kind and the detail.
    expect(registry.list()[1]).toMatchObject({ errorKind: "save", error: "offline" });
  });

  it("notifies subscribers, with a stable snapshot between changes", async () => {
    const { registry } = setup([plugin("a")]);
    const seen = vi.fn();
    registry.subscribe(seen);
    const before = registry.list();
    expect(registry.list()).toBe(before);
    await registry.setEnabled("a", true);
    expect(seen).toHaveBeenCalled();
    expect(registry.list()).not.toBe(before);
  });

  it("rejects duplicate ids and unknown ids", async () => {
    expect(() => setup([plugin("a"), plugin("a")])).toThrow(/Duplicate/);
    const { registry } = setup([plugin("a")]);
    await expect(registry.setEnabled("nope", true)).rejects.toThrow(/Unknown/);
  });

  it("dispose stops running plugins but keeps the stored choice", async () => {
    const store = memoryStore();
    const { registry, disposed } = setup([plugin("a")], store);
    await registry.setEnabled("a", true);
    await registry.dispose();
    expect(disposed).toEqual(["a"]);
    expect(store.saved.at(-1)).toEqual({ a: true });
  });
});
