export type LauncherMode = "files" | "commands";

export default function LauncherTabs({ mode, onChange }: {
  mode: LauncherMode;
  onChange: (mode: LauncherMode) => void;
}) {
  return (
    <div role="group" aria-label="Quick launcher mode" className="workspace-tabs">
      <button type="button" aria-pressed={mode === "files"} onClick={() => onChange("files")}>Files &amp; contents</button>
      <button type="button" aria-pressed={mode === "commands"} onClick={() => onChange("commands")}>Commands</button>
    </div>
  );
}
