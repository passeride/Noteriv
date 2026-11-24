// Link rewriting between the web's attachment URLs and repo-relative paths, so
// notes in a synced repo/zip stay portable (desktop and GitHub render the same
// relative links) while the web keeps pointing at its own download endpoint.
// The two directions are exact inverses for links the web produced.

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "tiff", "tif"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "webm", "flac", "aac", "m4a"];
const VIDEO_EXT = ["mp4", "mkv", "mov"];
/** Non-markdown files a sync treats as attachments (everything else in a repo is left alone). */
export const ASSET_EXTENSIONS = new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, "pdf"]);

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

export function isAssetFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && ASSET_EXTENSIONS.has(ext);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function resolve(dir: string, rel: string): string {
  const out: string[] = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Relative path from `fromDir` to `target` (both vault-relative, POSIX). */
function relative(fromDir: string, target: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = target.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Web download URLs -> repo-relative paths (applied when exporting notes to a repo/zip). */
export function toRelativeLinks(vaultId: string, notePath: string, content: string, pathById: Map<string, string>): string {
  const re = new RegExp(`/api/v1/vaults/${vaultId}/attachments/([0-9a-f-]{36})/download`, "g");
  const dir = dirname(notePath);
  return content.replace(re, (whole, id: string) => {
    const target = pathById.get(id);
    if (!target) return whole;
    return relative(dir, target)
      .split("/")
      .map((seg) => (seg === ".." ? seg : encodeURIComponent(seg)))
      .join("/");
  });
}

/** Repo-relative markdown links to known attachments -> web download URLs (applied when importing notes from a repo). */
export function fromRelativeLinks(vaultId: string, notePath: string, content: string, idByPath: Map<string, string>): string {
  const dir = dirname(notePath);
  return content.replace(/(!?\[[^\]]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (whole, head: string, rawTarget: string, tail: string) => {
    const target = rawTarget.startsWith("<") ? rawTarget.slice(1, -1) : rawTarget;
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return whole;
    const clean = safeDecode(target.split("#")[0].split("?")[0]);
    const id = idByPath.get(resolve(dir, clean).toLowerCase());
    return id ? `${head}/api/v1/vaults/${vaultId}/attachments/${id}/download${tail}` : whole;
  });
}
