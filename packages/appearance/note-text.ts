export const MIN_NOTE_FONT_SIZE = 11;
export const MAX_NOTE_FONT_SIZE = 32;

export function clampNoteFontSize(size: number): number {
  return Math.min(MAX_NOTE_FONT_SIZE, Math.max(MIN_NOTE_FONT_SIZE, Math.round(size)));
}
