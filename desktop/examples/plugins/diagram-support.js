function createElement(parent, tag, text) {
  const element = parent.ownerDocument.createElement(tag);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

async function loadDiagramBundle(assets) {
  if (!assets?.readText) throw new Error("Oppdater Noteriv til en versjon med støtte for pluginressurser.");
  async function read(name) {
    const text = await assets.readText(name);
    if (text === null) throw new Error("Installer hele pluginmappen på nytt fra ZIP-filen.");
    return text;
  }

  const { parts } = JSON.parse(await read("engine-index.json"));
  if (!Number.isInteger(parts) || parts < 1 || parts > 64) throw new Error("Pluginens motorfiler er ugyldige.");
  const chunks = [];
  // Keep the number of simultaneous bridge requests small on mobile.
  for (let offset = 0; offset < parts; offset += 4) {
    const count = Math.min(4, parts - offset);
    chunks.push(...await Promise.all(Array.from({ length: count }, (_, i) => read("engine-" + (offset + i) + ".txt"))));
  }

  const bytes = Uint8Array.from(atob(chunks.join("")), (character) => character.charCodeAt(0));
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  const inflate = new Function("module", "exports", await read("fflate.js") + "\nreturn module.exports.gunzipSync;");
  const module = { exports: {} };
  return new TextDecoder().decode(inflate(module, module.exports)(bytes));
}

function createDiagramRenderer(load, title) {
  let bundle;
  return async (source, signal, document) => {
    bundle ??= load().catch(error => { bundle = undefined; throw error; });
    const engine = await bundle;
    if (signal.aborted) throw new Error("Tegningen ble avbrutt.");

    // The engines use DOM layout. The isolated subdocument also restricts
    // network access for diagram syntax that refers to outside resources.
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:absolute;left:-10000px;width:768px;height:1px;border:0;pointer-events:none";
    frame.srcdoc = [
      '<!doctype html><meta http-equiv="Content-Security-Policy"',
      'content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\';',
      'img-src data: blob:; base-uri \'none\'; form-action \'none\'">',
      '<body><script>',
      engine.replace(/<\/script/gi, '<\\/script'),
      'addEventListener("message", async ({ data: source, ports, source: sender }) => {',
      '  if (sender !== parent || !ports[0]) return;',
      '  const port = ports[0];',
      '  try { const svg = await renderDiagram(source); port.postMessage({ svg }); }',
      '  catch (error) { port.postMessage({ error: String(error?.message || error) }); }',
      '  finally { port.close(); }',
      '}, { once: true });',
      '</script>',
    ].join("\n");

    const channel = new MessageChannel();
    return new Promise((resolve, reject) => {
      function finish(callback, value) {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        channel.port1.close();
        channel.port2.close();
        frame.remove();
        callback(value);
      }
      function abort() { finish(reject, new Error("Tegningen ble avbrutt.")); }
      const timer = setTimeout(() => finish(reject, new Error(title + " brukte for lang tid.")), 15_000);
      signal.addEventListener("abort", abort, { once: true });
      channel.port1.onmessage = ({ data }) => {
        if (data.error) finish(reject, new Error(data.error));
        else finish(resolve, data.svg);
      };
      frame.addEventListener("load", () => {
        frame.contentWindow?.postMessage(source, "*", [channel.port2]);
      }, { once: true });
      document.body.append(frame);
    });
  };
}

function registerDiagramPlugin(api, { language, title, templates }) {
  const render = createDiagramRenderer(() => loadDiagramBundle(api.assets), title);
  api.markdown.registerCodeBlockProcessor(language, (source, container) => {
    const panel = createElement(container, "section");
    panel.style.cssText = "min-width:0;padding:.65em;background:#f5f7fa;color:#20242c;border-radius:.5em;white-space:normal";
    const button = createElement(panel, "button", "Vis " + title + "-diagram");
    button.type = "button";
    button.style.cssText = "min-height:2.5rem;padding:.4em .8em;cursor:pointer";
    const message = createElement(panel, "div");
    message.setAttribute("role", "status");
    message.style.cssText = "overflow-wrap:anywhere;white-space:pre-wrap";
    let controller;
    let imageUrl;

    async function showDiagram() {
      if (source.length > 24_000) {
        message.textContent = "Diagramkoden kan ha opptil 24 000 tegn.";
        return;
      }
      controller = new AbortController();
      button.disabled = true;
      message.textContent = "Tegner diagram …";
      try {
        const svg = await render(source, controller.signal, panel.ownerDocument);
        if (controller.signal.aborted) return;
        if (typeof svg !== "string" || svg.length > 2_000_000 || !/<svg[\s>]/i.test(svg)) {
          throw new Error("Motoren returnerte et ugyldig eller for stort diagram.");
        }
        imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const image = createElement(panel, "img");
        image.alt = title + "-diagram";
        image.style.cssText = "display:block;max-width:100%;height:auto;margin-inline:auto";
        image.src = imageUrl;
        message.textContent = "";
        button.hidden = true;
      } catch (error) {
        if (controller.signal.aborted) return;
        message.textContent = String(error?.message || error).slice(0, 400);
        button.disabled = false;
      }
    }

    button.addEventListener("click", showDiagram);
    return () => {
      controller?.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      button.removeEventListener("click", showDiagram);
      panel.remove();
    };
  });

  let commandsVisible = false;
  function updateCommands() {
    const canInsert = Boolean(api.app.currentFile);
    if (canInsert === commandsVisible) return;
    commandsVisible = canInsert;
    for (const { id, name, source } of templates) {
      if (canInsert) {
        api.ui.addCommand({
          id,
          name: "Sett inn " + title + " – " + name,
          callback() {
            if (!api.app.currentFile || api.editor.getContent() === null) return;
            const fence = "```";
            api.editor.insertAtCursor("\n\n" + fence + language + "\n" + source + "\n" + fence + "\n\n");
          },
        });
      } else {
        api.ui.removeCommand(id);
      }
    }
  }
  const noteEvents = ["plugin-loaded", "file-open", "layout-change"];
  for (const event of noteEvents) api.events.on(event, updateCommands);
  return () => {
    for (const event of noteEvents) api.events.off(event, updateCommands);
  };
}
