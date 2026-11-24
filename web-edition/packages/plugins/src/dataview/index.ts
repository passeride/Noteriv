import type { CodeBlockProcessor, CorePlugin, PluginApi, VaultApi } from "@noteriv/plugin-api";
import type { NoteData } from "@noteriv/core/dataview";
import { scanVault } from "../shared/vault";
import { renderResult } from "./render";
import { pluginT } from "../shared/i18n";

/** Marks a block still being drawn; export waits for it to go (see core `PENDING_ATTRIBUTE`). */
const PENDING = "data-nrv-pending";

/** How long one vault scan serves further queries (several blocks in a note, re-renders while typing). */
export const SCAN_TTL_MS = 5000;

export const QUERY_TEMPLATE = '```dataview\nTABLE file.name, file.tags FROM "" SORT BY file.modified DESC LIMIT 10\n```';

/** Text shown inside a query block while it runs or when it fails. */
export interface DataviewText {
  running: string;
  error: (message: string) => string;
}

const ENGLISH: DataviewText = { running: "Running query...", error: (message) => `Error: ${message}` };

/**
 * Every note as a query sees it, read through the plugin API (one request per note on web). One scan is shared for
 * SCAN_TTL_MS; a change to the vault drops it.
 */
export function createNoteSource(vault: VaultApi) {
  let cached: { at: number; notes: Promise<NoteData[]> } | null = null;
  const scan = async (): Promise<NoteData[]> => {
    const { parseNoteData } = await import("@noteriv/core/dataview");
    const [notes, stats] = await Promise.all([scanVault(vault), vault.stats().catch(() => ({}) as Awaited<ReturnType<VaultApi["stats"]>>)]);
    return notes.map((n) => {
      const s = stats[n.path];
      return parseNoteData(n.path, n.content, {
        created: s ? new Date(s.createdAt).toISOString() : "",
        modified: s ? new Date(s.modifiedAt).toISOString() : "",
        size: n.content.length,
      });
    });
  };
  return {
    get(): Promise<NoteData[]> {
      if (!cached || Date.now() - cached.at > SCAN_TTL_MS) {
        const entry = { at: Date.now(), notes: scan() };
        cached = entry;
        entry.notes.catch(() => {
          if (cached === entry) cached = null;
        });
      }
      return cached.notes;
    },
    invalidate() {
      cached = null;
    },
  };
}

export function createDataviewProcessor(
  source: { get(): Promise<NoteData[]> },
  onOpen: (path: string) => void,
  text: DataviewText = ENGLISH
): CodeBlockProcessor {
  return (query, el) => {
    let cancelled = false;
    const container = document.createElement("div");
    container.className = "md-dataview";
    container.style.cssText =
      "background:var(--bg-tertiary);border:1px solid var(--border);border-radius:8px;padding:12px;margin:4px 0;font-size:12px;color:var(--text-primary)";
    const header = document.createElement("div");
    header.style.cssText = "font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px";
    header.textContent = "DATAVIEW";
    const status = document.createElement("div");
    status.style.cssText = "color:var(--text-secondary);font-size:12px";
    status.textContent = text.running;
    container.append(header, status);
    container.setAttribute(PENDING, "");
    el.appendChild(container);

    void (async () => {
      try {
        const { parseQuery, executeQuery } = await import("@noteriv/core/dataview");
        const parsed = parseQuery(query);
        if ("error" in parsed) throw new Error(parsed.error);
        const notes = await source.get();
        if (cancelled) return;
        status.remove();
        renderResult(container, executeQuery(parsed, notes), onOpen);
      } catch (err) {
        if (cancelled) return;
        status.textContent = text.error(err instanceof Error ? err.message : String(err));
        status.style.color = "var(--red)";
      }
      container.removeAttribute(PENDING);
    })();

    return () => {
      cancelled = true;
    };
  };
}

/** Dataview: ```dataview queries (TABLE / LIST / TASK over the vault's notes) and a command to insert one. */
const dataview: CorePlugin = {
  onload(api: PluginApi) {
    const t = pluginT(api, "dataview");
    const source = createNoteSource(api.vault);
    const invalidate = () => source.invalidate();
    api.events.on("vault-change", invalidate);
    api.events.on("file-save", invalidate);
    api.markdown.registerCodeBlockProcessor(
      "dataview",
      createDataviewProcessor(source, (path) => void api.workspace.openFile(path), {
        running: t("running"),
        error: (message) => t("error", { message }),
      })
    );
    api.ui.addCommand({
      id: "insert",
      name: t("insert"),
      callback: () => api.editor.insertAtCursor(QUERY_TEMPLATE),
    });
  },
};

export default dataview;
