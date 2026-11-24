import type { PluginApi } from "@noteriv/plugin-api";
import type { ScannedNote } from "../shared/vault";
import { extractCards, type Reviews } from "./cards";

/** What the plugin keeps through `api.settings` (per vault). */
export interface StoredFlashcards {
  version: 1;
  reviews: Reviews;
}

/**
 * The app's `loadPluginSettings` hands review data from before 2.2 in `legacyReviews` while the plugin has saved
 * nothing yet (web: `vault.settings.flashcardReviews`; desktop: `.noteriv/flashcard-reviews.json`). The old data is
 * left where it was, as a backup.
 */
interface SettingsBlob {
  version?: number;
  reviews?: Reviews;
  legacyReviews?: Reviews;
}

/**
 * Old review data keyed by the ids this plugin computes. Web ids were already vault-relative. Desktop ids hashed the
 * absolute path `listAllFiles` reported: the vault path as configured, then each folder joined by Rust's `Path::join`,
 * which on Windows uses `\` even after a vault path written with `/` (`C:/vault\Openings\e4.md`). So both joins are
 * tried. Each note is extracted once per path form and the cards are paired in order: hashing the trimmed question
 * again would miss Q: lines with trailing spaces. Reviews of cards that no longer exist are dropped (they stay in
 * the old location).
 */
export function migrateLegacyReviews(legacy: Reviews, notes: ScannedNote[], vaultPath: string | null): Reviews {
  if (!vaultPath) return { ...legacy };
  const base = vaultPath.replace(/[\\/]+$/, "");
  const out: Reviews = {};
  for (const note of notes) {
    const newCards = extractCards(note.content, note.path);
    for (const sep of ["/", "\\"]) {
      const oldCards = extractCards(note.content, `${base}${sep}${note.path.split("/").join(sep)}`);
      oldCards.forEach((old, i) => {
        const review = legacy[old.id];
        if (review) out[newCards[i].id] = { ...review, cardId: newCards[i].id };
      });
    }
  }
  return out;
}

/** Reviews for this vault, importing pre-2.2 data once (and saving right away so it never runs again). */
export async function loadReviews(api: PluginApi, notes: ScannedNote[]): Promise<Reviews> {
  const blob = (await api.settings.load()) as SettingsBlob;
  if (blob.version === 1) return blob.reviews ?? {};
  const reviews = blob.legacyReviews ? migrateLegacyReviews(blob.legacyReviews, notes, api.app.vaultPath) : {};
  await saveReviews(api, reviews);
  return reviews;
}

export async function saveReviews(api: PluginApi, reviews: Reviews): Promise<void> {
  const data: StoredFlashcards = { version: 1, reviews };
  await api.settings.save(data as unknown as Record<string, unknown>);
}
