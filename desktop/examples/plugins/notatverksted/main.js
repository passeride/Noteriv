const LANGUAGE = "notatverksted";
const STATUS_ID = "note-stats";
const CHECKLIST = [
  "```notatverksted",
  "- [ ] Huk av dette punktet i lesevisning",
  "- [ ] Åpne Notatverksted-panelet",
  "- [ ] Prøv å sette inn en ny sjekkliste fra kommandopaletten",
  "```",
].join("\n");

function element(parent, tag, text) {
  const child = parent.ownerDocument.createElement(tag);
  if (text !== undefined) child.textContent = text;
  parent.append(child);
  return child;
}

function renderChecklist(source, container) {
  const tasks = source.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    return match ? [{ checked: match[1] !== " ", title: match[2] }] : [];
  });
  const card = element(container, "section");
  card.style.cssText = "padding:.8em;border-radius:.6em;background:#242b38;color:#f0f3f8;color-scheme:dark;font:inherit;white-space:normal";
  if (tasks.length === 0) {
    element(card, "p", "Legg til oppgaver med formatet - [ ] Oppgave.");
    return () => card.remove();
  }

  element(card, "strong", "Sjekkliste");
  const summary = element(card, "p");
  summary.style.margin = ".35em 0";
  summary.setAttribute("role", "status");
  const progress = element(card, "progress");
  progress.max = tasks.length;
  progress.style.width = "100%";
  progress.setAttribute("aria-label", "Fremdrift");

  const rows = element(card, "div");
  const inputs = tasks.map((task) => {
    const label = element(rows, "label");
    label.style.cssText = "display:flex;align-items:baseline;gap:.55em;padding:.35em 0";
    const checkbox = element(label, "input");
    checkbox.type = "checkbox";
    checkbox.checked = task.checked;
    element(label, "span", task.title);
    return checkbox;
  });
  function refresh() {
    const checked = inputs.filter((input) => input.checked).length;
    progress.value = checked;
    summary.textContent = checked + " av " + tasks.length + " ferdig";
  }
  rows.addEventListener("change", refresh);
  refresh();
  return () => {
    rows.removeEventListener("change", refresh);
    card.remove();
  };
}

function start(api) {
  const panelRefreshers = new Set();
  let lastContent;
  let stats;
  let liveCounter = true;
  let statusText;
  let editorCommandsVisible = false;
  let creatingDemo = false;

  function readStats() {
    const content = api.editor.getContent();
    if (content !== lastContent) {
      lastContent = content;
      stats = content === null ? null : {
        words: (content.match(/\S+/g) || []).length,
        lines: content ? content.split("\n").length : 0,
      };
    }
    return stats;
  }

  function formatStats(current) {
    const lineLabel = current.lines === 1 ? " linje" : " linjer";
    return current.words + " ord · " + current.lines + lineLabel;
  }

  function showStats() {
    const current = readStats();
    if (current) api.ui.showNotice(formatStats(current));
  }

  function refreshCounter() {
    const current = liveCounter && api.app.currentFile ? readStats() : null;
    const nextText = current ? current.words + " ord" : undefined;
    if (nextText === statusText) return;
    statusText = nextText;
    if (nextText === undefined) api.ui.removeStatusBarItem(STATUS_ID);
    else api.ui.addStatusBarItem({
      id: STATUS_ID, text: nextText, title: "Notatverksted · Notatstatistikk", onClick: showStats,
    });
  }

  function insertChecklist() {
    if (api.app.currentFile && api.editor.getContent() !== null) {
      api.editor.insertAtCursor("\n\n" + CHECKLIST + "\n\n");
    }
  }

  function refreshEditorCommands() {
    const visible = Boolean(api.app.currentFile);
    if (visible === editorCommandsVisible) return;
    editorCommandsVisible = visible;
    if (visible) {
      api.ui.addCommand({ id: "stats", name: "Vis notatstatistikk", callback: showStats });
      api.ui.addCommand({
        id: "insert-checklist", name: "Sett inn sjekkliste", hotkey: "Ctrl+Shift+Y", callback: insertChecklist,
      });
    } else {
      api.ui.removeCommand("stats");
      api.ui.removeCommand("insert-checklist");
    }
  }

  function refreshNote() {
    refreshEditorCommands();
    refreshCounter();
    for (const refresh of panelRefreshers) refresh();
  }

  async function createDemo() {
    if (creatingDemo) return;
    creatingDemo = true;
    try {
      const base = "Notatverksted – demo";
      let path = base + ".md";
      for (let number = 2; await api.vault.exists(path); number++) {
        path = base + " " + number + ".md";
      }
      const note = [
        "# Notatverksted",
        "Prøv sjekklisten i lesevisning. Kommandopaletten kan også sette den inn i andre notater.",
        CHECKLIST,
      ].join("\n\n") + "\n";
      if (!await api.vault.write(path, note)) throw new Error("Write failed");
      api.ui.showNotice("Opprettet " + path);
    } catch {
      api.ui.showNotice("Kunne ikke opprette demonotatet i vaultet.");
    } finally {
      creatingDemo = false;
    }
  }

  api.markdown.registerCodeBlockProcessor(LANGUAGE, renderChecklist);
  api.ui.addCommand({ id: "create-demo", name: "Lag demonotat i vaultet", callback: createDemo });
  api.ui.addSidebarPanel({
    id: "workbench", title: "Notatverksted", icon: "stats-chart",
    render(container) {
      const panel = element(container, "section");
      const name = element(panel, "strong");
      const details = element(panel, "p");
      const button = element(panel, "button", "Lag demonotat");
      button.type = "button";
      button.addEventListener("click", createDemo);

      function update() {
        const current = api.app.currentFile ? readStats() : null;
        name.textContent = api.app.currentFile || "Ingen åpne notater";
        details.textContent = current ? formatStats(current) : "";
      }
      update();
      panelRefreshers.add(update);
      return () => {
        panelRefreshers.delete(update);
        button.removeEventListener("click", createDemo);
        panel.remove();
      };
    },
  });

  api.ui.addSettingsTab({
    id: "preferences", name: "Notatverksted",
    render(container) {
      const label = element(container, "label");
      const checkbox = element(label, "input");
      checkbox.type = "checkbox";
      checkbox.checked = liveCounter;
      element(label, "span", " Vis ordtelling i statuslinjen i denne økten");
      function onChange() {
        liveCounter = checkbox.checked;
        refreshCounter();
      }
      checkbox.addEventListener("change", onChange);
      return () => {
        checkbox.removeEventListener("change", onChange);
        label.remove();
      };
    },
  });

  // The mobile host also loads this script inside each Markdown block.
  // Only the main host sends lifecycle and editor events, so block loads skip note statistics.
  const noteEvents = ["plugin-loaded", "file-open", "editor-change", "layout-change"];
  for (const event of noteEvents) api.events.on(event, refreshNote);
  return () => {
    for (const event of noteEvents) api.events.off(event, refreshNote);
    panelRefreshers.clear();
  };
}

let stop;
module.exports = {
  onLoad(api) { stop = start(api); },
  onUnload() { stop?.(); },
};
