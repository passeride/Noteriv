import { useCallback, useEffect, useMemo, useState } from "react";
import { childPath } from "./file-path";
import { loadVaultIndex } from "./vault-index";
import { decorationKey, DECORATIONS_FILE, fileDecoration, parseDecorationFile, updateDecoration, type FileDecoration } from "./file-decorations";

export function useFileDecorations(vault: string | undefined, revision: number) {
  const [state, setState] = useState<{ vault: string; entries: Record<string, unknown>; icons: Map<string, string> }>();
  const current = state?.vault === vault ? state : undefined;
  useEffect(() => {
    const api = window.electronAPI;
    if (!vault || !api) return;
    let active = true;
    const config = childPath(vault, DECORATIONS_FILE);
    const reload = () => {
      void Promise.all([
        api.readFile(config).then(parseDecorationFile).catch(() => ({})),
        loadVaultIndex(vault),
      ]).then(([entries, notes]) => {
        if (!active) return;
        const icons = new Map<string, string>();
        for (const note of notes) {
          const icon = note.properties.icon;
          if (typeof icon === "string" && icon.trim()) icons.set(note.relativePath, icon);
        }
        setState({ vault, entries, icons });
      });
    };
    reload();
    return () => { active = false; };
  }, [vault, revision]);

  const byPath = useMemo(() => (path: string): FileDecoration => {
    const key = vault && decorationKey(vault, path);
    if (!key || !current) return {};
    const edit = fileDecoration(Object.hasOwn(current.entries, key) ? current.entries[key] : undefined);
    return { symbol: edit.symbol ?? current.icons.get(key), color: edit.color };
  }, [current, vault]);

  const save = useCallback(async (path: string, decoration: FileDecoration) => {
    const key = vault && decorationKey(vault, path);
    const api = window.electronAPI;
    if (!vault || !key || !api) throw new Error("Choose a file or folder inside the vault.");
    const config = childPath(vault, DECORATIONS_FILE);
    const entries = updateDecoration(parseDecorationFile(await api.readFile(config)), key, decoration);
    if (!await api.writeFile(config, JSON.stringify(entries, null, 2) + "\n")) {
      throw new Error("Could not save the file decoration.");
    }
    setState(previous => previous?.vault !== vault && previous ? previous : {
      vault, entries, icons: previous?.icons ?? new Map(),
    });
  }, [vault]);

  return { byPath, save };
}
