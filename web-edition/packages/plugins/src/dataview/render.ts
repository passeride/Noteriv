import type { QueryResult } from "@noteriv/core/dataview";

/**
 * Draws a dataview result as the editor showed it before Dataview became a plugin (plain DOM, inline styles).
 * Note names are links: `onOpen` gets the note's vault-relative path.
 */
export function renderResult(container: HTMLElement, result: QueryResult, onOpen: (path: string) => void): void {
  const link = (text: string, path: string, extra = "") => {
    const a = document.createElement("span");
    a.className = "md-wikilink";
    a.style.cssText = `color:var(--accent);cursor:pointer${extra}`;
    a.textContent = text;
    a.setAttribute("data-target", path);
    a.addEventListener("mousedown", (e) => {
      // The editor would otherwise move the cursor into the block and replace the widget with its source.
      e.preventDefault();
      e.stopPropagation();
    });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (path) onOpen(path);
    });
    return a;
  };
  const footer = (text: string) => {
    const f = document.createElement("div");
    f.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:8px;text-align:right";
    f.textContent = text;
    container.appendChild(f);
  };

  if (result.type === "TABLE") {
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
    const headerRow = table.createTHead().insertRow();
    for (const f of result.fields) {
      const th = document.createElement("th");
      th.style.cssText = "text-align:left;padding:4px 8px;color:var(--text-secondary);font-size:11px;font-weight:600;border-bottom:1px solid var(--border)";
      th.textContent = f;
      headerRow.appendChild(th);
    }
    const tbody = table.createTBody();
    for (const row of result.rows) {
      const tr = tbody.insertRow();
      tr.style.borderTop = "1px solid var(--bg-tertiary)";
      for (const f of result.fields) {
        const td = tr.insertCell();
        td.style.cssText = "padding:4px 8px;color:var(--text-primary)";
        if (f === "file.name") td.appendChild(link(row[f] || "", row["file.path"] || ""));
        else td.textContent = row[f] || "";
      }
    }
    container.appendChild(table);
    footer(`${result.rows.length} results`);
  } else if (result.type === "LIST") {
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0";
    for (const row of result.rows) {
      const li = document.createElement("li");
      li.style.padding = "3px 0";
      li.appendChild(link(row["file.name"] || "", row["file.path"] || ""));
      ul.appendChild(li);
    }
    container.appendChild(ul);
    footer(`${result.rows.length} results`);
  } else if (result.type === "TASK" && result.tasks) {
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0";
    for (const task of result.tasks) {
      const li = document.createElement("li");
      li.style.cssText = `display:flex;align-items:flex-start;gap:6px;padding:3px 0;color:${task.completed ? "var(--text-muted)" : "var(--text-primary)"};font-size:12px`;
      const check = document.createElement("span");
      check.style.cssText = `width:14px;height:14px;border-radius:3px;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;font-size:9px;${task.completed ? "background:var(--green);color:var(--bg-primary)" : "border:1.5px solid var(--text-muted)"}`;
      check.textContent = task.completed ? "✓" : "";
      li.appendChild(check);
      const text = document.createElement("span");
      text.style.textDecoration = task.completed ? "line-through" : "none";
      text.textContent = task.text;
      li.appendChild(text);
      li.appendChild(link(task.fileName, task.filePath, ";font-size:10px;opacity:0.6;margin-left:auto"));
      ul.appendChild(li);
    }
    container.appendChild(ul);
    footer(`${result.tasks.length} tasks`);
  }
}
