"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { extractEmbed, parseLinkTarget, stripBlockIds } from "@noteriv/core/note-embed";
import { getEmbedSource } from "../markdown/vault-hooks";
import { useT } from "../i18n/react";

/** Characters of a note shown in the preview. */
const PREVIEW_CHARS = 600;

export interface NoteHoverPreviewProps {
  /** Raw `[[target]]` text of the link the pointer rests over (`Note`, `Note#Heading`, `Note#^id`, `Note|alias`). */
  target: string;
  /** Pointer position, in viewport pixels. */
  position: { x: number; y: number };
  onDismiss: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "missing" }
  | { kind: "noSection" }
  | { kind: "failed" };

/**
 * A card over a wiki-link the pointer rests on: the start of the note it names (or the heading's section, or the
 * block), or the image. Found and read through the app's embed source, so web and desktop resolve links the same way
 * as `![[embeds]]` do.
 */
export default function NoteHoverPreview({ target, position, onDismiss }: NoteHoverPreviewProps) {
  const t = useT();
  const parsed = parseLinkTarget(target);
  const [state, setState] = useState<State>({ kind: "loading" });
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(position);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const source = getEmbedSource();
    if (!source) {
      setState({ kind: "missing" });
      return;
    }
    const { note, heading, block } = parseLinkTarget(target);
    source
      .load(note)
      .then((found) => {
        if (cancelled) return;
        if (!found) return setState({ kind: "missing" });
        if ("image" in found) return setState({ kind: "image", src: found.image });
        const part = extractEmbed(found.content, { heading, block });
        if (part === null) return setState({ kind: "noSection" });
        const text = stripBlockIds(part).trim();
        setState({ kind: "text", text: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Escape, or the page scrolling under it, closes it (the link it points at has moved).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onDismiss]);

  // Kept inside the window: below the pointer, else above it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = position.x;
    let y = position.y + 20;
    if (x + rect.width > window.innerWidth - 16) x = window.innerWidth - rect.width - 16;
    if (x < 16) x = 16;
    if (y + rect.height > window.innerHeight - 16) y = position.y - rect.height - 8;
    if (y < 16) y = 16;
    setPlaced({ x, y });
  }, [position, state]);

  const title = [parsed.note, parsed.heading ? `# ${parsed.heading}` : parsed.block ? `^${parsed.block}` : ""].filter(Boolean).join(" › ");

  return (
    <div ref={ref} className="hp-container" role="tooltip" style={{ left: `${placed.x}px`, top: `${placed.y}px` }} onMouseLeave={onDismiss}>
      <div className="hp-header">
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
        <span className="hp-title">{title}</span>
      </div>
      <div className="hp-body">
        {state.kind === "loading" && <div className="hp-loading">{t("panels.hoverPreview.loading")}</div>}
        {state.kind === "text" && (state.text ? <pre className="hp-preview-text">{state.text}</pre> : <div className="hp-not-found">{t("panels.hoverPreview.empty")}</div>)}
        {state.kind === "image" && <img className="hp-image" src={state.src} alt={parsed.note} />}
        {state.kind === "missing" && <div className="hp-not-found">{t("panels.hoverPreview.notFound")}</div>}
        {state.kind === "noSection" && <div className="hp-not-found">{t("panels.hoverPreview.noSection")}</div>}
        {state.kind === "failed" && <div className="hp-not-found">{t("panels.hoverPreview.readFailed")}</div>}
      </div>
    </div>
  );
}
