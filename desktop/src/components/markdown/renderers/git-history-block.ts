import { registerCodeBlockProcessor } from "@/lib/markdown-code-block-registry";
import { noteContaining } from "@/lib/note-path";
import { activityFolder, activityTimeline, relativeGitPath, type PathActivity } from "../../../../../packages/git-client/path-history";

export function registerGitHistoryBlock(): void {
  registerCodeBlockProcessor("core", "githistory", (source, container) => {
    container.classList.add("md-query");
    const title = document.createElement("div");
    title.className = "md-query-header";
    title.textContent = "Git activity";
    const body = document.createElement("div");
    body.className = "md-query-body";
    body.textContent = "Loading Git activity…";
    container.append(title, body);
    let active = true;
    // Wait until CodeMirror attaches the widget so we can read its own note and vault.
    const frame = requestAnimationFrame(async () => {
      const host = container.closest("[data-vault-path]");
      const vault = host?.getAttribute("data-vault-path");
      const file = noteContaining(container) ?? host?.getAttribute("data-open-file");
      if (!vault || !window.electronAPI?.gitNative) {
        body.textContent = "Git history is available in Git vaults.";
        return;
      }
      try {
        const folder = activityFolder(source, file ? relativeGitPath(vault, file) : null);
        const entries = await window.electronAPI.gitNative<PathActivity[]>({ action: "pathActivity", dir: vault, path: folder });
        if (!active) return;
        const timeline = activityTimeline(entries);
        if (!timeline) {
          body.textContent = "No commits in this folder.";
          return;
        }
        body.textContent = `${timeline.first} – ${timeline.last} · ${timeline.total} commits`;
        const graph = document.createElement("div");
        graph.className = "md-git-activity";
        graph.setAttribute("role", "list");
        graph.setAttribute("aria-label", "Commit activity over time");
        for (const { label, count } of timeline.buckets) {
          const bar = document.createElement("span");
          bar.setAttribute("role", "listitem");
          bar.title = `${label}: ${count} commits`;
          bar.setAttribute("aria-label", bar.title);
          bar.className = count ? "md-git-activity-bar active" : "md-git-activity-bar";
          bar.style.height = `${Math.max(3, 36 * count / timeline.peak)}px`;
          graph.appendChild(bar);
        }
        body.appendChild(graph);
      } catch (error) {
        if (active) body.textContent = String(error);
      }
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  });
}
