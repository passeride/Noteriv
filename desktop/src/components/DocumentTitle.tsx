"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { noteTitleOf } from "@/lib/file-path";
import { relativePathFromVault } from "@/lib/knowledge/path-safety";
import { readProperties } from "@/lib/properties";

interface DocumentTitleProps {
  filePath: string;
  vaultPath?: string;
  readingContent?: string;
  onRename: (newName: string) => void;
}

export default function DocumentTitle({ filePath, vaultPath, readingContent, onRename }: DocumentTitleProps) {
  const displayName = noteTitleOf(filePath);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);
  const breadcrumb = vaultPath ? (relativePathFromVault(vaultPath, filePath) ?? "").split("/").slice(0, -1).join(" / ") : "";
  const banner = useMemo(() => {
    if (!readingContent) return undefined;
    const value = readProperties(readingContent).find(property => property.key === "banner")?.value;
    return typeof value === "string" ? value.trim().replace(/^!?\[\[|\]\]$/g, "") : undefined;
  }, [readingContent]);
  const [localBanner, setLocalBanner] = useState<{ key: string; url: string }>();
  const [failedBanner, setFailedBanner] = useState<string>();
  const imagePath = vaultPath && banner && !banner.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\")) &&
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(banner) ? `${vaultPath}/${banner}` : null;
  useEffect(() => {
    if (!imagePath) return;
    let active = true;
    void import("./markdown/renderers/images").then(({ loadLocalImage }) => loadLocalImage(imagePath))
      .then(url => { if (active && url) setLocalBanner({ key: imagePath, url }); });
    return () => { active = false; };
  }, [imagePath]);
  const image = banner && /^https:\/\//i.test(banner) ? banner
    : localBanner?.key === imagePath ? localBanner.url : undefined;

  useEffect(() => {
    setEditValue(displayName);
    setEditing(false);
  }, [filePath, displayName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const submit = useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === displayName) {
      setEditValue(displayName);
      setEditing(false);
      return;
    }
    onRename(trimmed);
    setEditing(false);
  }, [editValue, displayName, onRename]);

  if (editing) {
    return (
      <div className="doc-title-bar">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setEditValue(displayName);
              setEditing(false);
            }
          }}
          onBlur={submit}
          className="doc-title-input"
        />
      </div>
    );
  }

  return (
    <div className={`doc-title-bar${readingContent !== undefined ? " workspace-reading-title" : ""}`}>
      {!!breadcrumb && <span className="workspace-breadcrumb">{breadcrumb}</span>}
      {image && image !== failedBanner && <img alt="Note banner" src={image} className="workspace-note-banner"
        onError={() => setFailedBanner(image)} />}
      <span
        onClick={() => setEditing(true)}
        className="doc-title-text"
        title={filePath}
      >
        {displayName}
      </span>
    </div>
  );
}
