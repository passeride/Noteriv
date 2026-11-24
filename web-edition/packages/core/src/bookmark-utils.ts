/**
 * Bookmark utilities. A bookmark is an opaque string key: web uses the stable note id (it survives
 * rename/move; persisted in Vault.settings.bookmarks), desktop uses the file path.
 */

export function toggleBookmark(bookmarks: string[], noteId: string): string[] {
  return isBookmarked(bookmarks, noteId) ? bookmarks.filter((b) => b !== noteId) : [...bookmarks, noteId];
}

export function isBookmarked(bookmarks: string[], noteId: string): boolean {
  return bookmarks.includes(noteId);
}
