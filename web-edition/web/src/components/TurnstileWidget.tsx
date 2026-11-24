"use client";

import { useEffect, useRef } from "react";
import { getLocale } from "@noteriv/ui/i18n";

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page, however many widgets ask. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

interface Props {
  siteKey: string;
  /** The passed check's token, or null once it expires or fails. A token works for one request. */
  onToken: (token: string | null) => void;
  /** Change it after each submit: the token was spent, so the widget runs the check again. */
  resetSignal?: number;
}

/**
 * Cloudflare Turnstile bot check (sign-up and forgot-password pages), shown only when the server sends a site key in
 * GET /auth/registration. Usually passes by itself; sometimes asks for one click.
 */
export default function TurnstileWidget({ siteKey, onToken, resetSignal = 0 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Latest callback without re-rendering the widget when the parent re-renders.
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        widgetId.current = api.render(box.current, {
          sitekey: siteKey,
          theme: "auto",
          language: getLocale(),
          // The normal widget is 300 px wide; below the `sm` breakpoint the auth card is narrower than that.
          size: window.innerWidth < 640 ? "compact" : "normal",
          callback: (token: string) => tokenRef.current(token),
          "expired-callback": () => tokenRef.current(null),
          "error-callback": () => tokenRef.current(null),
        });
      })
      .catch(() => tokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal === 0 || !widgetId.current) return;
    tokenRef.current(null);
    window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  return <div ref={box} className="min-h-[65px] flex justify-center" />;
}
