/** What a ```chessboard block says, with every field optional except the position itself. */
export interface ChessboardConfig {
  fen: string | null;
  orientation: "white" | "black";
  /**
   * True (the default) checks the FEN's structure before drawing (8 ranks, 8 squares each, known letters); false draws
   * whatever it can. Kings are never required: lesson positions often have one king or none.
   */
  strict: boolean;
  annotations: string[];
  /** Draw the file letters (a-h) and rank numbers (1-8) around the board. Off by default. */
  labels: boolean;
  /** Board width in pixels, 100 to 600; null = the default width. */
  size: number | null;
  /** Per-block override of the saved default piece set; null = no override. */
  pieceset: string | null;
  /** Per-block override of the saved default board theme; null = no override. */
  boardtheme: string | null;
}

export type FenCheck = { valid: true } | { valid: false; error: string };

/** Reads `key: value` lines; a key with an empty value takes the following lines as its value (annotations lists). */
export function parseChessboardBlock(source: string): ChessboardConfig {
  const fields: Record<string, string> = {};
  let pendingKey: string | null = null;

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) {
      pendingKey = null;
      continue;
    }
    const kv = line.match(/^([a-zA-Z]+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1].toLowerCase();
      const value = kv[2].trim();
      fields[key] = value;
      pendingKey = value === "" ? key : null;
      continue;
    }
    if (pendingKey) fields[pendingKey] = fields[pendingKey] ? `${fields[pendingKey]},${line}` : line;
  }

  return {
    fen: fields.fen || null,
    orientation: (fields.orientation || "white").toLowerCase() === "black" ? "black" : "white",
    strict: fields.strict === undefined ? true : fields.strict.toLowerCase() !== "false",
    annotations: (fields.annotations || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    labels: /^(true|yes|on|1)$/i.test(fields.labels ?? ""),
    size: parseSize(fields.size),
    pieceset: fields.pieceset ? fields.pieceset.toLowerCase() : null,
    boardtheme: fields.boardtheme ? fields.boardtheme.toLowerCase() : null,
  };
}

export const MIN_SIZE = 100;
export const MAX_SIZE = 600;

/** `size: 280` (or `280px`); anything else, or a number out of range, means the default width. */
function parseSize(value: string | undefined): number | null {
  const m = /^(\d{1,4})(?:px)?$/i.exec((value ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= MIN_SIZE && n <= MAX_SIZE ? n : null;
}

export function validateFEN(fen: unknown): FenCheck {
  if (typeof fen !== "string" || !fen.trim()) return { valid: false, error: "FEN is empty" };
  const parts = fen.trim().split(/\s+/);
  const rows = (parts[0] || "").split("/");
  if (rows.length !== 8) return { valid: false, error: `Expected 8 ranks, got ${rows.length}` };

  for (const row of rows) {
    let count = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) count += Number(ch);
      else if (/[prnbqkPRNBQK]/.test(ch)) count += 1;
      else return { valid: false, error: `Invalid character "${ch}" in rank "${row}"` };
    }
    if (count !== 8) return { valid: false, error: `Rank "${row}" does not sum to 8 squares` };
  }

  if (parts[1] && !/^[wb]$/.test(parts[1])) return { valid: false, error: `Invalid side to move "${parts[1]}"` };
  if (parts[2] && !/^(-|[KQkq]{1,4})$/.test(parts[2])) return { valid: false, error: `Invalid castling field "${parts[2]}"` };
  if (parts[3] && !/^(-|[a-h][36])$/.test(parts[3])) return { valid: false, error: `Invalid en passant field "${parts[3]}"` };
  return { valid: true };
}

/** Top-left corner of a square in the 400x400 drawing (each square 50), or null when `square` is not a1..h8. */
export function squareToXY(square: string | null | undefined, orientation: "white" | "black"): { x: number; y: number } | null {
  const name = typeof square === "string" ? square.toLowerCase() : "";
  if (!/^[a-h][1-8]$/.test(name)) return null;
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  const col = orientation === "black" ? 7 - file : file;
  const row = orientation === "black" ? rank : 7 - rank;
  return { x: col * 50, y: row * 50 };
}
