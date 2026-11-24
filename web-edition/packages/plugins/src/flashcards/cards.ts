/**
 * Flashcards: extraction and SM-2 scheduling. Pure functions, moved unchanged from the apps'
 * `lib/flashcard-utils.ts` (phase 2.2), so card ids and schedules match what users already have.
 *
 * Cards come from notes as
 *   Q: question text
 *   A: answer text
 * or cloze deletions: {{cloze text}}
 */

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  /** Path the id was computed from (vault-relative since 2.2). */
  source: string;
  type: "qa" | "cloze";
}

export interface CardReview {
  cardId: string;
  /** Easiness factor, starts at 2.5. */
  ease: number;
  /** Days until next review. */
  interval: number;
  repetitions: number;
  /** ISO date (YYYY-MM-DD). */
  nextReview: string;
  lastReview: string;
}

export type Reviews = Record<string, CardReview>;

/** Extract flashcards from markdown content. */
export function extractCards(content: string, filePath: string): Flashcard[] {
  const cards: Flashcard[] = [];
  const lines = content.split("\n");

  // Q: / A: pairs
  for (let i = 0; i < lines.length; i++) {
    const qMatch = lines[i].match(/^Q:\s*(.+)/i);
    if (qMatch && i + 1 < lines.length) {
      const aMatch = lines[i + 1].match(/^A:\s*(.+)/i);
      if (aMatch) {
        cards.push({
          id: hashCard(qMatch[1], filePath),
          question: qMatch[1].trim(),
          answer: aMatch[1].trim(),
          source: filePath,
          type: "qa",
        });
        i++; // skip the answer line
      }
    }
  }

  // Cloze deletions: {{text}}
  const clozeRegex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = clozeRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split("\n").pop() || "";
    const fullLine = line + match[0] + (content.substring(match.index + match[0].length).split("\n")[0] || "");
    const question = fullLine.replace(/\{\{([^}]+)\}\}/g, "[...]");
    cards.push({
      id: hashCard(question, filePath),
      question,
      answer: match[1],
      source: filePath,
      type: "cloze",
    });
  }

  return cards;
}

/** Cards due for review today (never reviewed counts as due). */
export function getDueCards(cards: Flashcard[], reviews: Reviews, today = isoDate(new Date())): Flashcard[] {
  return cards.filter((card) => {
    const review = reviews[card.id];
    if (!review) return true;
    return review.nextReview <= today;
  });
}

/** SM-2: grade a card (0-5) and return its updated review. */
export function gradeCard(cardId: string, grade: number, reviews: Reviews, now = new Date()): CardReview {
  const existing = reviews[cardId];
  const today = isoDate(now);

  let ease = existing?.ease ?? 2.5;
  let interval = existing?.interval ?? 0;
  let reps = existing?.repetitions ?? 0;

  if (grade >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps++;
    ease = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  } else {
    // Incorrect: start over.
    reps = 0;
    interval = 1;
  }

  if (ease < 1.3) ease = 1.3;

  const next = new Date(now);
  next.setDate(next.getDate() + interval);

  return { cardId, ease, interval, repetitions: reps, nextReview: isoDate(next), lastReview: today };
}

export function hashCard(text: string, source: string): string {
  let hash = 0;
  const str = `${source}:${text}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `fc-${Math.abs(hash).toString(36)}`;
}

// Same as the old `toISOString().split("T")[0]` (UTC date), kept so schedules do not shift.
function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
