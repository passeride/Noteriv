import { EditorView } from "@codemirror/view";

/**
 * What a click on a rendered link should do: a `[[wiki-link]]` or a relative `[text](Note.md)` opens a note of the
 * vault; a web or mail address opens outside the app. Null when the click was not on a rendered link.
 */
export function clickedLink(target: EventTarget | null): { note: string } | { url: string } | null {
  const el = target instanceof Element ? target : null;
  const wiki = el?.closest(".md-wikilink")?.getAttribute("data-target");
  if (wiki) return { note: wiki };
  const href = el?.closest("a.md-link")?.getAttribute("href");
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return { url: href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null; // other schemes, in-page anchors
  try {
    return { note: decodeURIComponent(href).replace(/^\.\//, "") };
  } catch {
    return { note: href };
  }
}

/**
 * Click handling for rendered links in the editor and the reading view, for a host that passes `openNote` (the web
 * app). Opening a note goes through it (the app finds or creates the note); an address opens in a new browser tab,
 * never in place of the app. Without `openNote` the handler does nothing: the desktop app handles link clicks itself.
 */
export function linkClickHandler(openNote: () => ((target: string) => void) | undefined, beforeOpen?: () => void) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const open = openNote();
      if (!open || event.button !== 0) return false;
      const link = clickedLink(event.target);
      if (!link) return false;
      event.preventDefault();
      if ("url" in link) {
        window.open(link.url, "_blank", "noopener,noreferrer");
      } else {
        beforeOpen?.();
        open(link.note);
      }
      return true;
    },
    // The browser must not follow a rendered <a> itself (that would leave the app).
    click(event) {
      if (!openNote() || !clickedLink(event.target)) return false;
      event.preventDefault();
      return true;
    },
  });
}
