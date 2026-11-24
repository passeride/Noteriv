"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROPERTY_TYPES, type PropertyType, type PropertyTypes } from "@noteriv/core/properties";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";

/** Vault settings key holding the type of each property name. */
export const PROPERTY_TYPES_SETTING = "propertyTypes";

/** Where a vault's property types are kept. */
export interface PropertyTypesStore {
  load(): Promise<PropertyTypes>;
  save(types: PropertyTypes): Promise<void>;
}

export function cleanPropertyTypes(raw: unknown): PropertyTypes {
  const out: PropertyTypes = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && (PROPERTY_TYPES as string[]).includes(v)) out[k] = v as PropertyType;
    }
  }
  return out;
}

/**
 * The default store: the `propertyTypes` key of the adapter's settings, which are per vault on the web. Saving re-reads
 * the settings first, so other keys written meanwhile are kept.
 */
export function settingsPropertyTypesStore(adapter: VaultAdapter): PropertyTypesStore {
  return {
    load: async () => cleanPropertyTypes((await adapter.getSettings())[PROPERTY_TYPES_SETTING]),
    save: async (types) => {
      const settings = await adapter.getSettings();
      await adapter.saveSettings({ ...settings, [PROPERTY_TYPES_SETTING]: types });
    },
  };
}

/**
 * The vault's property types (one type per property name, for every note). Changes are applied one after the other,
 * each on the latest saved types, so two quick changes never undo each other.
 */
export function usePropertyTypes(store: PropertyTypesStore | null) {
  const [types, setTypes] = useState<PropertyTypes>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setTypes({});
    store
      ?.load()
      .then((t) => !cancelled && setTypes(t))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store]);

  const update = useCallback(
    (change: (current: PropertyTypes) => PropertyTypes) => {
      if (!store) return Promise.resolve();
      const run = queue.current.then(async () => {
        const next = change(await store.load());
        setTypes(next);
        await store.save(next);
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [store]
  );

  const setType = useCallback((key: string, type: PropertyType) => update((t) => ({ ...t, [key]: type })), [update]);

  const renameType = useCallback(
    (oldKey: string, newKey: string) =>
      update((t) => {
        if (!(oldKey in t)) return t;
        const { [oldKey]: type, ...rest } = t;
        return { ...rest, [newKey]: type };
      }),
    [update]
  );

  return { types, setType, renameType };
}
