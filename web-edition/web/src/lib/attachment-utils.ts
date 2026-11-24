/**
 * Attachment helpers for the web app. Pure classification/formatting logic
 * ported verbatim from desktop/src/lib/attachment-utils.ts; everything that
 * touched `window.electronAPI`/local filesystem there is replaced here by
 * `webApi.attachments.*` (object storage, see web/server/src/lib/attachments.ts).
 */

export type AttachmentType = "image" | "audio" | "video" | "pdf" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "tiff", "tif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "webm", "flac", "aac", "m4a", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"]);
// .webm can be audio or video; audio wins since the (future) recorder produces webm.

export function getAttachmentType(filename: string): AttachmentType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext) && ext !== "webm") return "video";
  if (ext === "webm") return "audio";
  return "other";
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Markdown to insert for an attachment, pointing at its server download URL. */
export function markdownLinkForAttachment(name: string, type: AttachmentType, url: string): string {
  switch (type) {
    case "image":
      return `![${name}](${url})`;
    case "audio":
      return `![Audio](${url})`;
    case "video":
      return `![Video](${url})`;
    default:
      return `[${name}](${url})`;
  }
}
