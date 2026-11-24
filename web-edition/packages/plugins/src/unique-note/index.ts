import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";

/** What the note is named after, by default: minutes are enough to keep names apart when writing by hand. */
export const DEFAULT_FORMAT = "YYYYMMDDHHmm";

export interface UniqueNoteSettings {
  /** Vault folder the notes go in ("" for the vault root). */
  folder: string;
  /** Name pattern: YYYY MM DD HH mm ss are replaced by the time, text in [brackets] is kept as is, the rest too. */
  format: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * One part of a path as Windows (and links) allow it: without \ / : * ? " < > | # ^ [ ] or control characters, without
 * dots or spaces at the end, and not a device name (`CON`, `NUL`, `COM1`…), which gets a `_`.
 */
export function safePart(part: string): string {
  const cleaned = part
    .replace(/[\u0000-\u001f\\/:*?"<>|#^[\]]/g, "")
    .trim()
    .replace(/[. ]+$/, "");
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) ? `${cleaned}_` : cleaned;
}

/** The note name for `date` (local time) by `format`. */
export function uniqueName(date: Date, format: string): string {
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  // [Text in brackets] is kept, so a word with "mm" in it (`[Summary]`) stays a word.
  const name = (format.trim() || DEFAULT_FORMAT)
    .split(/(\[[^\]]*\])/)
    .map((piece) => (piece.startsWith("[") && piece.endsWith("]") ? piece.slice(1, -1) : piece.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token])))
    .join("");
  return safePart(name) || parts.YYYY + parts.MM + parts.DD + parts.HH + parts.mm;
}

/** A folder setting as a vault path: no leading, trailing or doubled slashes, no `.`/`..` parts, each part safe. */
export function cleanFolder(folder: string): string {
  return folder
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .map(safePart)
    .filter(Boolean)
    .join("/");
}

async function readSettings(api: PluginApi): Promise<UniqueNoteSettings> {
  const blob = await api.settings.load().catch(() => ({}) as Record<string, unknown>);
  return {
    folder: typeof blob.folder === "string" ? blob.folder : "",
    format: typeof blob.format === "string" && blob.format.trim() ? blob.format : DEFAULT_FORMAT,
  };
}

/** Creates the note (`<folder>/<name>.md`, then `<name> 2.md`… when taken) and opens it. */
export async function createUniqueNote(api: PluginApi, now = new Date()): Promise<string> {
  const { folder, format } = await readSettings(api);
  const dir = cleanFolder(folder);
  const base = `${dir ? `${dir}/` : ""}${uniqueName(now, format)}`;
  let path = `${base}.md`;
  for (let n = 2; await api.vault.exists(path); n++) path = `${base} ${n}.md`;
  await api.vault.write(path, "");
  await api.workspace.openFile(path);
  return path;
}

/** Unique note creator: a command that makes a note named by the current time (Zettelkasten-style ids). */
const uniqueNote: CorePlugin = {
  onload(api: PluginApi) {
    const t = pluginT(api, "uniqueNote");
    // The hotkey pressed twice quickly must not write the same new note twice.
    let creating = false;
    api.ui.addCommand({
      id: "create",
      name: t("command"),
      callback: async () => {
        if (creating) return;
        creating = true;
        try {
          await createUniqueNote(api);
        } catch (e) {
          console.error("[unique-note] create failed:", e);
          api.ui.showNotice(t("failed"));
        } finally {
          creating = false;
        }
      },
    });
    api.ui.addSettingsTab({
      id: "settings",
      name: t("settings"),
      render(container) {
        let cancelled = false;
        const field = (label: string, hint: string) => {
          const wrap = container.appendChild(document.createElement("label"));
          wrap.className = "un-field";
          wrap.appendChild(document.createElement("span")).textContent = label;
          const input = wrap.appendChild(document.createElement("input"));
          input.type = "text";
          input.className = "un-input";
          const small = wrap.appendChild(document.createElement("small"));
          small.className = "un-hint";
          small.textContent = hint;
          return { input, small };
        };
        const folder = field(t("folder"), t("folderHint"));
        const format = field(t("format"), "");
        format.input.placeholder = DEFAULT_FORMAT;
        const preview = () => {
          const dir = cleanFolder(folder.input.value);
          format.small.textContent = t("preview", { path: `${dir ? `${dir}/` : ""}${uniqueName(new Date(), format.input.value)}.md` });
        };
        // Saved shortly after typing stops, and when the settings close with an edit not saved yet.
        let edited = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const save = () => {
          if (timer) clearTimeout(timer);
          timer = null;
          void api.settings
            .save({ folder: cleanFolder(folder.input.value), format: format.input.value.trim() || DEFAULT_FORMAT })
            .catch(() => api.ui.showNotice(t("saveFailed")));
        };
        for (const f of [folder, format]) {
          f.input.addEventListener("input", () => {
            edited = true;
            preview();
            if (timer) clearTimeout(timer);
            timer = setTimeout(save, 500);
          });
        }
        void readSettings(api).then((s) => {
          // What the person already typed wins over the stored values arriving late.
          if (cancelled || edited) return;
          folder.input.value = s.folder;
          format.input.value = s.format;
          preview();
        });
        return () => {
          cancelled = true;
          if (timer) save();
          container.replaceChildren();
        };
      },
    });
  },
};

export default uniqueNote;
