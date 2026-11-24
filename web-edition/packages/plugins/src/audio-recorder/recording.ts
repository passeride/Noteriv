/** Pure helpers of the audio recorder (moved from the apps' lib/audio-utils.ts, identical on web and desktop). */

/** `recording-YYYY-MM-DD-HHmmss.webm`, local time. */
export function generateRecordingFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `recording-${date}-${time}.webm`;
}

/** Seconds as mm:ss. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The markdown both apps inserted for a recording. */
export function audioMarkdown(target: string): string {
  return `![Audio](${target})`;
}

/** A readable message from a failed save (web API errors carry `body.message`). */
export function saveErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { body?: { message?: string } } | null)?.body;
  return body?.message ?? fallback;
}
