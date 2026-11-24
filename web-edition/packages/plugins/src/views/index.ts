import type { CodeBlockProcessor, CorePlugin, FileView, PluginApi, VaultApi } from "@noteriv/plugin-api";
import {
  coerceValue,
  deleteProperty,
  inferPropertyType,
  readProperties,
  writeProperty,
  type PropertyValue,
} from "@noteriv/core/properties";
import {
  fieldValue,
  formatCell,
  isViewFile,
  parseViewSpec,
  runView,
  setViewLayout,
  viewFileSettings,
  VIEW_FILE_EXT,
  VIEW_FILE_TEMPLATE,
  VIEW_LAYOUTS,
  type ViewLayout,
  type ViewNote,
  type ViewSpec,
} from "@noteriv/core/views";
import { pluginT } from "../shared/i18n";
import { createKindFile } from "../shared/new-file";
import { listMarkdown } from "../shared/vault";

/** Id of the file view that shows `.view` files (and notes marked `view: true`). */
export const FILE_VIEW_ID = "view-file";

/** Marks a block still being drawn; export waits for it to go (see core `PENDING_ATTRIBUTE`). */
const PENDING = "data-nrv-pending";

/** Drag data type of a kanban card (its note path). */
const CARD_TYPE = "text/x-noteriv-view-card";

/** Views on screen redraw this long after the last vault change (a save, a sync) rather than on each. */
const REDRAW_DELAY_MS = 300;

/** How long one read of the vault's properties serves further views (several blocks, re-renders while typing). */
export const SOURCE_TTL_MS = 5000;

export const VIEW_TEMPLATE = "```view\nfrom: \nwhere: \nlayout: table\ncolumns: [file, status, tags]\nsort: file.name\n```";

/** Text the views show. */
export interface ViewTexts {
  notes: (count: number) => string;
  error: (setting: string) => string;
  empty: string;
  none: string;
  open: string;
  edit: string;
}

const ENGLISH: ViewTexts = {
  notes: (n) => `${n} note${n === 1 ? "" : "s"}`,
  error: (s) => `Check the "${s}" setting.`,
  empty: "No notes match.",
  none: "None",
  open: "Open note",
  edit: "Click to edit",
};

/**
 * Every note as views see it: its properties (from the front matter only, in one request on web) and dates. One read
 * is shared for SOURCE_TTL_MS; a change to the vault drops it.
 */
export function createViewSource(vault: VaultApi, now: () => number = Date.now) {
  let cached: { at: number; notes: Promise<ViewNote[]> } | null = null;
  /** Values a view just wrote, laid over what is read for EDIT_OVERRIDE_MS (until the note has surely been saved). */
  const overrides = new Map<string, { at: number; field: string; value: PropertyValue }[]>();
  const withOverrides = (notes: ViewNote[]): ViewNote[] =>
    notes.map((n) => {
      const list = (overrides.get(n.path) ?? []).filter((o) => now() - o.at < EDIT_OVERRIDE_MS);
      if (list.length === 0) return n;
      const properties = { ...n.properties };
      for (const o of list) {
        if (o.value === null) delete properties[o.field];
        else properties[o.field] = o.value;
      }
      return { ...n, properties };
    });
  const scan = async (): Promise<ViewNote[]> => {
    const [paths, blocks, stats] = await Promise.all([listMarkdown(vault), vault.frontmatter(), vault.stats().catch(() => ({}) as Awaited<ReturnType<VaultApi["stats"]>>)]);
    const byPath = new Map(blocks.map((b) => [b.path, b.block]));
    return (
      paths
        .map((path) => {
          const properties: Record<string, PropertyValue> = {};
          for (const p of readProperties(byPath.get(path) ?? "").properties) if (!p.complex) properties[p.key] = p.value;
          const s = stats[path];
          return { path, properties, created: s?.createdAt ?? 0, modified: s?.modifiedAt ?? 0 };
        })
        // A view file on web is a note marked `view: true`: settings, not one of the notes it lists.
        .filter((n) => n.properties.view !== true)
    );
  };
  return {
    get(): Promise<ViewNote[]> {
      if (!cached || now() - cached.at > SOURCE_TTL_MS) {
        const entry = { at: now(), notes: scan() };
        cached = entry;
        entry.notes.catch(() => {
          if (cached === entry) cached = null;
        });
      }
      return cached.notes.then(withOverrides);
    },
    invalidate() {
      cached = null;
    },
    /**
     * Records that a view set (or, with null, removed) a property of one note: the note may be saved a moment later
     * (an open tab saves on its own), so a read of the vault in between would show the old value.
     */
    patch(path: string, field: string, value: PropertyValue) {
      // Expired entries go first, so the map holds only recent edits.
      for (const [p, list] of overrides) {
        const fresh = list.filter((o) => now() - o.at < EDIT_OVERRIDE_MS);
        if (fresh.length === 0) overrides.delete(p);
        else overrides.set(p, fresh);
      }
      const list = (overrides.get(path) ?? []).filter((o) => o.field !== field);
      overrides.set(path, [...list, { at: now(), field, value }]);
    },
  };
}

/** How long a value a view wrote wins over what is read from the vault (the editor saves well within it). */
export const EDIT_OVERRIDE_MS = 10000;

export interface ViewDeps {
  open(path: string): void;
  /** Changes a note's text (through its open tab when it has one). */
  edit(path: string, transform: (text: string) => string | null): Promise<boolean>;
  /** Registers a view on screen to be redrawn when the vault changes; returns the unregister. */
  subscribe?(redraw: () => void): () => void;
  texts?: ViewTexts;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Whether a field is a property the view can change (not `file.*`). */
const editable = (field: string) => field !== "file" && !field.startsWith("file.");

/**
 * The ```view processor. Rows come from `source`; changing a cell or moving a kanban card writes the property through
 * `deps.edit`, then the view draws again from fresh data.
 */
export function createViewProcessor(
  source: { get(): Promise<ViewNote[]>; invalidate(): void; patch(path: string, field: string, value: PropertyValue): void },
  deps: ViewDeps
): CodeBlockProcessor {
  const t = deps.texts ?? ENGLISH;
  return (text, root) => {
    let cancelled = false;
    const container = el("div", "nv-view");
    root.appendChild(container);

    const parsed = parseViewSpec(text);
    /** Writes a property through `deps.edit`; whatever happens, the view draws again (an unchanged value restores the cell). */
    const writeAndRedraw = async (note: ViewNote, field: string, value: PropertyValue, transform: (body: string) => string | null) => {
      try {
        if (await deps.edit(note.path, transform)) source.patch(note.path, field, value);
      } catch {
        // Not written (the note changed meanwhile, no network…): drawn again from what is known.
      }
      void draw();
    };

    const setProperty = async (note: ViewNote, field: string, input: string | boolean) => {
      const current = fieldValue(note, field);
      const type = current === null ? (typeof input === "boolean" ? "checkbox" : "text") : inferPropertyType(field, current);
      const value = coerceValue(type, input);
      // Text that is not a number for a number property: a typo, never written over the value.
      if (value === null && typeof input === "string" && input.trim() !== "") {
        void draw();
        return;
      }
      await writeAndRedraw(note, field, value, (body) => writeProperty(body, field, value));
    };

    const link = (note: ViewNote) => {
      const a = el("button", "nv-link", formatCell(note, "file"));
      a.type = "button";
      a.title = t.open;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deps.open(note.path);
      });
      return a;
    };

    /** A cell's content: the note link, a checkbox, or text that turns into an input on click. */
    const cell = (note: ViewNote, field: string): HTMLElement => {
      if (field === "file" || field === "file.name") return link(note);
      const value = fieldValue(note, field);
      if (editable(field) && typeof value === "boolean") {
        const box = el("input", "nv-check") as HTMLInputElement;
        box.type = "checkbox";
        box.checked = value;
        box.addEventListener("change", () => void setProperty(note, field, box.checked));
        return box;
      }
      const span = el("span", "nv-cell", formatCell(note, field));
      if (!editable(field)) return span;
      span.classList.add("nv-editable");
      span.title = t.edit;
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = el("input", "nv-input") as HTMLInputElement;
        const original = formatCell(note, field);
        input.value = original;
        let done = false;
        const finish = (save: boolean) => {
          if (done) return;
          done = true;
          if (save && input.value !== original) void setProperty(note, field, input.value);
          else input.replaceWith(span);
        };
        input.addEventListener("keydown", (k) => {
          k.stopPropagation();
          if (k.key === "Enter") finish(true);
          if (k.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        span.replaceWith(input);
        input.focus();
        input.select();
      });
      return span;
    };

    const table = (spec: ViewSpec, groups: ReturnType<typeof runView>["groups"]) => {
      const tbl = el("table", "nv-table");
      const head = el("tr");
      for (const c of spec.columns) head.appendChild(el("th", undefined, c === "file" ? "" : c));
      tbl.appendChild(el("thead")).appendChild(head);
      const body = tbl.appendChild(el("tbody"));
      for (const g of groups) {
        if (spec.group) {
          const tr = body.appendChild(el("tr", "nv-group-row"));
          const th = tr.appendChild(el("th", undefined, `${g.key ?? t.none} · ${t.notes(g.rows.length)}`));
          th.colSpan = spec.columns.length;
        }
        for (const note of g.rows) {
          const tr = body.appendChild(el("tr"));
          for (const c of spec.columns) tr.appendChild(el("td")).appendChild(cell(note, c));
        }
      }
      return tbl;
    };

    const cards = (spec: ViewSpec, groups: ReturnType<typeof runView>["groups"]) => {
      const wrap = el("div");
      for (const g of groups) {
        if (spec.group) wrap.appendChild(el("div", "nv-group-title", `${g.key ?? t.none} · ${t.notes(g.rows.length)}`));
        const grid = wrap.appendChild(el("div", "nv-cards"));
        for (const note of g.rows) {
          const card = grid.appendChild(el("div", "nv-card"));
          card.appendChild(link(note));
          for (const c of spec.columns.filter((c) => c !== "file" && c !== "file.name")) {
            const row = card.appendChild(el("div", "nv-card-row"));
            row.appendChild(el("span", "nv-card-key", c));
            row.appendChild(cell(note, c));
          }
        }
      }
      return wrap;
    };

    const list = (spec: ViewSpec, groups: ReturnType<typeof runView>["groups"]) => {
      const wrap = el("div");
      for (const g of groups) {
        if (spec.group) wrap.appendChild(el("div", "nv-group-title", `${g.key ?? t.none} · ${t.notes(g.rows.length)}`));
        const ul = wrap.appendChild(el("ul", "nv-list"));
        for (const note of g.rows) {
          const li = ul.appendChild(el("li"));
          li.appendChild(link(note));
          const extra = spec.columns.filter((c) => c !== "file" && c !== "file.name").map((c) => formatCell(note, c)).filter(Boolean);
          if (extra.length) li.appendChild(el("span", "nv-list-extra", ` — ${extra.join(" · ")}`));
        }
      }
      return wrap;
    };

    /** Columns by the group property; dragging a card to another column sets (or, to "None", removes) it. */
    const kanban = (spec: ViewSpec, groups: ReturnType<typeof runView>["groups"]) => {
      const board = el("div", "nv-kanban");
      const field = spec.group!;
      for (const g of groups) {
        const col = board.appendChild(el("div", "nv-column"));
        col.dataset.key = g.key ?? "";
        col.appendChild(el("div", "nv-column-title", `${g.key ?? t.none} · ${g.rows.length}`));
        // Only cards of this view are accepted (not files or text dragged from elsewhere).
        const isCard = (e: DragEvent) => !!e.dataTransfer?.types?.includes(CARD_TYPE);
        col.addEventListener("dragover", (e) => {
          if (!isCard(e)) return;
          e.preventDefault();
          col.classList.add("nv-drop");
        });
        col.addEventListener("dragleave", () => col.classList.remove("nv-drop"));
        col.addEventListener("drop", (e) => {
          col.classList.remove("nv-drop");
          if (!isCard(e)) return;
          e.preventDefault();
          const path = e.dataTransfer?.getData(CARD_TYPE);
          const note = groups.flatMap((x) => x.rows).find((n) => n.path === path);
          // The column a card is in is its value's first item, as text.
          const from = note ? formatCell(note, field).split(", ")[0] || null : null;
          if (!note || from === g.key) return;
          const current = fieldValue(note, field);
          let value: PropertyValue;
          if (Array.isArray(current)) {
            // A list (tags…): the item of the column it leaves is replaced by this column's; the others stay.
            const rest = current.filter((item) => item !== from);
            value = g.key === null ? rest : [g.key, ...rest.filter((item) => item !== g.key)];
            if (value.length === 0) value = null;
          } else {
            value = g.key === null ? null : coerceValue(current === null ? "text" : inferPropertyType(field, current), g.key);
          }
          void writeAndRedraw(note, field, value, (body) => (value === null ? deleteProperty(body, field) : writeProperty(body, field, value)));
        });
        for (const note of g.rows) {
          const card = col.appendChild(el("div", "nv-card nv-kanban-card"));
          card.draggable = true;
          card.dataset.path = note.path;
          card.addEventListener("dragstart", (e) => e.dataTransfer?.setData(CARD_TYPE, note.path));
          card.appendChild(link(note));
          for (const c of spec.columns.filter((c) => c !== "file" && c !== "file.name" && c !== field)) {
            const v = formatCell(note, c);
            if (v) card.appendChild(el("div", "nv-card-row", v));
          }
        }
      }
      return board;
    };

    async function draw() {
      container.setAttribute(PENDING, "");
      try {
        if (parsed.error !== undefined) {
          container.replaceChildren(el("div", "nv-error", t.error(parsed.error)));
          return;
        }
        const spec = parsed.spec;
        const notes = await source.get();
        if (cancelled) return;
        const result = runView(spec, notes);
        const header = el("div", "nv-header", t.notes(result.total));
        const body =
          result.total === 0
            ? el("div", "nv-empty", t.empty)
            : spec.layout === "cards"
              ? cards(spec, result.groups)
              : spec.layout === "list"
                ? list(spec, result.groups)
                : spec.layout === "kanban"
                  ? kanban(spec, result.groups)
                  : table(spec, result.groups);
        container.replaceChildren(header, body);
      } catch (err) {
        if (!cancelled) container.replaceChildren(el("div", "nv-error", err instanceof Error ? err.message : String(err)));
      } finally {
        container.removeAttribute(PENDING);
      }
    }

    void draw();
    const unsubscribe = deps.subscribe?.(() => void draw());
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  };
}

/** Text the view file's bar shows. */
export interface ViewFileTexts {
  layouts: Record<ViewLayout, string>;
  /** Tells where the settings are changed (the editor's source mode). */
  hint: string;
}

/**
 * Shows a view file: a bar to switch the layout (written into the file), and the view drawn by `processor` from the
 * file's settings, the same as a ```view block with that text.
 */
export function createViewFileView(processor: CodeBlockProcessor, texts: ViewFileTexts): FileView {
  return {
    id: FILE_VIEW_ID,
    match: isViewFile,
    mount(container, ctx) {
      let content = ctx.content;
      const wrap = container.appendChild(el("div", "nv-file"));
      const bar = wrap.appendChild(el("div", "nv-file-bar"));
      const body = wrap.appendChild(el("div", "nv-file-body"));
      let cleanup: void | (() => void);
      const draw = () => {
        if (cleanup) cleanup();
        body.replaceChildren();
        const settings = viewFileSettings(content);
        const layout = parseViewSpec(settings).spec?.layout;
        for (const [l, b] of buttons) {
          b.classList.toggle("nv-active", l === layout);
          b.setAttribute("aria-pressed", String(l === layout));
        }
        cleanup = processor(settings, body, { source: settings, language: "view", sourcePath: ctx.path });
      };
      const buttons = VIEW_LAYOUTS.map((l) => {
        const b = bar.appendChild(el("button", "nv-layout", texts.layouts[l]));
        b.type = "button";
        b.addEventListener("click", () => {
          const next = setViewLayout(content, l);
          if (next === content) return;
          content = next;
          ctx.setContent(next);
          draw();
        });
        return [l, b] as const;
      });
      bar.appendChild(el("span", "nv-file-hint", texts.hint));
      draw();
      return {
        update(next) {
          content = next;
          draw();
        },
        destroy() {
          if (cleanup) cleanup();
        },
      };
    },
  };
}

/** Views: ```view blocks show notes by their properties as a table, cards, a list or a kanban board, editable. */
const views: CorePlugin = {
  onload(api: PluginApi) {
    const t = pluginT(api, "views");
    const source = createViewSource(api.vault);
    // Views on screen follow changes made elsewhere (another note saved, a sync), redrawn once things settle.
    const live = new Set<() => void>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      source.invalidate();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        for (const redraw of live) redraw();
      }, REDRAW_DELAY_MS);
    };
    api.events.on("vault-change", changed);
    api.events.on("file-save", changed);
    const processor = createViewProcessor(source, {
        open: (path) => void api.workspace.openFile(path),
        edit: (path, transform) => api.vault.edit(path, transform),
        subscribe: (redraw) => {
          live.add(redraw);
          return () => live.delete(redraw);
        },
        texts: {
          notes: (count) => t("notes", { count }),
          error: (setting) => t("error", { setting }),
          empty: t("empty"),
          none: t("none"),
          open: t("open"),
          edit: t("edit"),
        },
      });
    api.markdown.registerCodeBlockProcessor("view", processor);
    api.ui.registerFileView(
      createViewFileView(processor, {
        layouts: { table: t("layouts.table"), cards: t("layouts.cards"), list: t("layouts.list"), kanban: t("layouts.kanban") },
        hint: t("fileHint"),
      })
    );
    api.ui.addCommand({
      id: "insert",
      name: t("insert"),
      callback: () => api.editor.insertAtCursor(VIEW_TEMPLATE),
    });
    api.ui.addCommand({
      id: "new",
      name: t("create"),
      callback: async () => {
        try {
          await createKindFile(api, { base: "View", desktopExt: VIEW_FILE_EXT, marker: "view", body: VIEW_FILE_TEMPLATE });
        } catch (e) {
          console.error("[views] create failed:", e);
          api.ui.showNotice(t("failed"));
        }
      },
    });
  },
};

export default views;
