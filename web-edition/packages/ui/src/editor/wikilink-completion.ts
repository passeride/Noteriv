import { EditorView } from "@codemirror/view";
import { CompletionContext, autocompletion, type Completion } from "@codemirror/autocomplete";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";
import { slashCompletions } from "./slash-commands";

/** What a suggestion is called: the bare file name (web) or the vault-relative path (desktop, where names can repeat). */
export type WikilinkLabel = "name" | "path";

interface CachedNotes {
  time: number;
  /** Which label style the entries were built with, so a change does not serve stale labels. */
  label: WikilinkLabel;
  entries: string[];
}

const CACHE_TTL = 5000;
// Per adapter: a vault switch hands the editor a different adapter, so entries never leak across vaults.
const cache = new WeakMap<VaultAdapter, CachedNotes>();

async function loadLabels(adapter: VaultAdapter, label: WikilinkLabel): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(adapter);
  if (hit && hit.label === label && now - hit.time < CACHE_TTL) return hit.entries;

  try {
    const notes = await adapter.listNotes();
    const entries = notes.map((n) => (label === "path" ? n.path : n.name).replace(/\.(md|markdown)$/i, ""));
    cache.set(adapter, { time: now, label, entries });
    return entries;
  } catch {
    return hit?.entries ?? [];
  }
}

/** The completion source itself (exported for tests; hosts use wikilinkAutocompletion). */
export function wikilinkCompletions(getAdapter: () => VaultAdapter | null, label: WikilinkLabel) {
  return async (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = textBefore.match(/\[\[([^\]]*)$/);
    if (!match) return null;

    const adapter = getAdapter();
    if (!adapter) return null;

    const query = match[1].toLowerCase();
    const from = context.pos - match[1].length;

    const labels = await loadLabels(adapter, label);

    const options: Completion[] = labels
      .filter((l) => !query || l.toLowerCase().includes(query))
      .slice(0, 30)
      .map((l) => ({
        label: l,
        apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
          // Count how many ] chars exist right after the cursor
          const docLen = view.state.doc.length;
          let closingBrackets = 0;
          for (let i = to; i < Math.min(to + 2, docLen); i++) {
            if (view.state.doc.sliceString(i, i + 1) === "]") closingBrackets++;
            else break;
          }
          // Replace from query start through any existing ]], always end with ]]
          const replaceTo = to + closingBrackets;
          const insert = l + "]]";
          view.dispatch({
            changes: { from, to: replaceTo, insert },
            selection: { anchor: from + insert.length },
          });
        },
      }));

    return {
      from,
      options,
      filter: false,
    };
  };
}

/**
 * `[[` completion over the vault's notes. `getAdapter` is read on every keystroke, so the editor can be built once
 * and still follow a later adapter (it returns null while none is available and suggestions simply stay off).
 */
export function wikilinkAutocompletion(getAdapter: () => VaultAdapter | null, label: WikilinkLabel = "name") {
  return autocompletion({
    // The `/` command menu shares this autocompletion, so the two menus never compete.
    override: [wikilinkCompletions(getAdapter, label), slashCompletions],
    activateOnTyping: true,
    defaultKeymap: true,
  });
}
