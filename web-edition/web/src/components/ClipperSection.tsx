"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { webApi, isEmailUnverified } from "@/lib/webApi";
import { formatDate, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

type TokenRow = Awaited<ReturnType<typeof webApi.clipper.list>>[number];

/** Messages the bookmarklet shows on the clipped page; fixed when it is created (it runs outside the app). */
interface BookmarkletText {
  saved: string;
  errorStatus: string;
  blocked: string;
}

/** Builds the bookmarklet: sends the selection (or the main article) to this server with the clip token. */
function bookmarkletFor(origin: string, token: string, text: BookmarkletText): string {
  const code = `(function(){try{var s=window.getSelection(),h="";if(s&&s.rangeCount&&!s.isCollapsed){var d=document.createElement("div");d.appendChild(s.getRangeAt(0).cloneContents());h=d.innerHTML}else{var a=document.querySelector("article,main")||document.body;h=a.innerHTML.slice(0,1400000)}fetch(${JSON.stringify(
    origin + "/api/v1/clip"
  )},{method:"POST",headers:{"Content-Type":"application/json",Authorization:${JSON.stringify(
    "Bearer " + token
  )}},body:JSON.stringify({title:document.title,url:location.href,html:h})}).then(function(r){alert(r.ok?${JSON.stringify(text.saved)}:${JSON.stringify(text.errorStatus)}+r.status)}).catch(function(){alert(${JSON.stringify(text.blocked)})})}catch(e){alert("Noteriv clipper: "+e.message)}})();`;
  return "javascript:" + encodeURIComponent(code);
}

/**
 * Settings > Clipper. Web counterpart of desktop's local clipper (127.0.0.1:27123): a
 * bookmarklet that posts the current selection/article to this server. The token it
 * embeds can only create notes in one vault (see server routes/clipper.ts).
 */
export default function ClipperSection({ vaultId, vaultName }: { vaultId: string; vaultName: string }) {
  useLocale();
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState(() => t("web.clipper.defaultName"));
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const refresh = useCallback(() => {
    webApi.clipper.list().then(setTokens).catch(() => setTokens([]));
  }, []);
  useEffect(refresh, [refresh]);

  // React refuses javascript: hrefs, so the bookmarklet link is set on the DOM node directly.
  useEffect(() => {
    if (fresh && linkRef.current) linkRef.current.setAttribute(
        "href",
        bookmarkletFor(window.location.origin, fresh.token, {
          saved: t("web.clipper.saved"),
          errorStatus: t("web.clipper.errorStatus"),
          blocked: t("web.clipper.blocked"),
        })
      );
  }, [fresh]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const created = await webApi.clipper.create(name.trim() || t("web.clipper.fallbackName"), vaultId);
      setFresh({ token: created.token, name: created.name });
      refresh();
    } catch (err) {
      setError(isEmailUnverified(err) ? t("web.account.verifyFirst") : t("web.clipper.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  function revoke(id: string) {
    if (armed !== id) {
      setArmed(id);
      setTimeout(() => setArmed((a) => (a === id ? null : a)), 4000);
      return;
    }
    setArmed(null);
    webApi.clipper.revoke(id).then(refresh).catch(() => setError(t("web.clipper.revokeFailed")));
  }

  return (
    <div className="st-section">
      <div className="st-row-desc" style={{ marginBottom: 10 }}>
        {t("web.clipper.intro", { vault: vaultName })}
      </div>

      <Row2 label={t("web.clipper.new.label")} desc={t("web.clipper.new.desc")}>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="st-text-input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="st-test-btn" disabled={busy} onClick={create}>
            {busy ? t("web.clipper.creating") : t("web.clipper.create")}
          </button>
        </div>
      </Row2>
      {error && <div className="st-test-result st-test-fail">{error}</div>}

      {fresh && (
        <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, padding: 12, margin: "8px 0" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t("web.clipper.ready", { name: fresh.name })}</div>
          <div className="st-row-desc" style={{ margin: "6px 0" }}>
            {t("web.clipper.dragHint")}
          </div>
          <a
            ref={linkRef}
            draggable
            className="st-test-btn"
            style={{ display: "inline-block", cursor: "grab" }}
            onClick={(e) => e.preventDefault()}
          >
            📎 Clip to Noteriv
          </a>
          <div className="st-row-desc" style={{ marginTop: 8 }}>
            {t("web.clipper.cspHint")}
          </div>
        </div>
      )}

      <div className="st-divider" />
      <div className="st-group-label">{t("web.clipper.active")}</div>
      {tokens === null && <div className="st-row-desc">{t("web.clipper.loading")}</div>}
      {tokens?.length === 0 && <div className="st-row-desc">{t("web.clipper.none")}</div>}
      {tokens?.map((tok) => (
        <div key={tok.id} className="st-row">
          <div className="st-row-info">
            <span className="st-row-label">
              {tok.name} <span style={{ opacity: 0.6 }}>…{tok.tokenHint}</span>
            </span>
            <span className="st-row-desc">
              {t("web.clipper.usage", {
                vault: tok.vaultName,
                used: tok.lastUsedAt
                  ? t("web.clipper.lastUsed", { time: formatDate(new Date(tok.lastUsedAt), { dateStyle: "short", timeStyle: "short" }) })
                  : t("web.clipper.unused"),
              })}
            </span>
          </div>
          <div className="st-row-control">
            <button className="st-test-btn" onClick={() => revoke(tok.id)}>
              {armed === tok.id ? t("web.clipper.revokeConfirm") : t("web.clipper.revoke")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row2({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-info">
        <span className="st-row-label">{label}</span>
        <span className="st-row-desc">{desc}</span>
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}
