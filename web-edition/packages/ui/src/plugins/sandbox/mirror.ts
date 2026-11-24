/**
 * Host side of the plugin "DOM mirror".
 *
 * Plugins render into a real DOM inside their sandbox iframe (that's what
 * `el.innerHTML = …` / `container.querySelector(…)` need), but that DOM can't be
 * shown to the user directly: the iframe is hidden and has no access to the page.
 * The sandbox serialises its container (html + the plugin's own <style> text) and
 * the host shows a *sanitised copy* inside a Shadow DOM root:
 *   - Shadow DOM scopes the plugin's CSS to its own widget, so a plugin can't restyle
 *     the app;
 *   - DOMPurify removes scripts, iframes, forms and event-handler attributes;
 *   - `contain: paint` keeps position:fixed descendants inside the widget.
 * Clicks and input/change events are forwarded back to the sandbox by the
 * `data-nrv` index the sandbox stamped on each element, where they are replayed on
 * the plugin's real elements — so plugin `addEventListener` handlers keep working.
 */

import DOMPurify from "dompurify";

export interface MirrorPayload {
  html: string;
  css: string;
}

export interface MirrorEvent {
  index: number;
  type: "click" | "input" | "change";
  value?: string;
  checked?: boolean;
}

const FORBID_TAGS = ["script", "iframe", "object", "embed", "base", "link", "meta", "form", "style", "frame", "frameset"];
const FORBID_ATTR = ["srcdoc", "formaction", "action", "ping"];

/** Drops fetches/imports and legacy script hooks from plugin CSS. Everything else (selectors, layout, colours) is allowed. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/behavior\s*:[^;}]*/gi, "")
    // external urls would make the widget phone home; data: images and in-document fragments stay
    .replace(/url\(\s*(['"]?)(?!data:image\/|#)[^)]*\1\s*\)/gi, "none")
    .slice(0, 200_000);
}

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof Element && node.hasAttribute("style")) {
      const style = (node.getAttribute("style") ?? "").replace(/position\s*:\s*(fixed|sticky)\s*;?/gi, "");
      node.setAttribute("style", style);
    }
    if (node instanceof HTMLAnchorElement) {
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }
  });
}

export function sanitizePluginHtml(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR, ADD_ATTR: ["data-nrv"] });
}

// svg/img shrink with the editor column (a fixed-width chessboard was clipped next to open side panels).
const HOST_STYLE = ":host{display:block;contain:paint;overflow:hidden;max-width:100%}svg,img{max-width:100%;height:auto}";

/**
 * Shows `payload` inside a shadow root attached to `host`. Returns a function that
 * updates the content in place and a disposer. `onEvent` receives forwarded user events.
 */
export function mountMirror(host: HTMLElement, onEvent?: (e: MirrorEvent) => void) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  const tagIndex = (el: EventTarget | undefined): number | null => {
    let cur = el instanceof Element ? el : null;
    while (cur) {
      const raw = cur.getAttribute?.("data-nrv");
      if (raw !== null && raw !== undefined) return Number(raw);
      cur = cur.parentElement;
    }
    return null;
  };

  const handler = (type: MirrorEvent["type"]) => (ev: Event) => {
    const target = (ev.composedPath()[0] ?? ev.target) as HTMLElement | null;
    if (!target) return;
    if (type === "click") {
      const anchor = target.closest?.("a");
      if (anchor) {
        ev.preventDefault();
        const href = anchor.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
    }
    const index = tagIndex(target);
    if (index === null || !onEvent) return;
    const input = target as HTMLInputElement;
    onEvent({
      index,
      type,
      value: "value" in input ? input.value : undefined,
      checked: "checked" in input ? input.checked : undefined,
    });
  };

  const listeners: Array<[string, (e: Event) => void]> = [
    ["click", handler("click")],
    ["input", handler("input")],
    ["change", handler("change")],
  ];
  for (const [name, fn] of listeners) root.addEventListener(name, fn);

  const update = (payload: MirrorPayload) => {
    // Keep the focused control focused across re-renders (the sandbox re-sends the whole tree on every change).
    const active = root.activeElement as HTMLElement | null;
    const activeIndex = active ? tagIndex(active) : null;
    const selection =
      active && "selectionStart" in active ? [(active as HTMLInputElement).selectionStart, (active as HTMLInputElement).selectionEnd] : null;

    root.innerHTML = `<style>${HOST_STYLE}${sanitizeCss(payload.css)}</style>${sanitizePluginHtml(payload.html)}`;

    if (activeIndex !== null) {
      const next = root.querySelector<HTMLElement>(`[data-nrv="${activeIndex}"]`);
      if (next) {
        next.focus();
        if (selection && "setSelectionRange" in next) {
          try {
            (next as HTMLInputElement).setSelectionRange(selection[0], selection[1]);
          } catch {
            // not a text-like control
          }
        }
      }
    }
  };

  const dispose = () => {
    for (const [name, fn] of listeners) root.removeEventListener(name, fn);
    root.innerHTML = "";
  };

  return { update, dispose };
}
