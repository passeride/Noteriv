const LANGUAGE = "spinnvill-pattern";
const SVG_NS = "http://www.w3.org/2000/svg";

function createElement(parent, tag, text) {
  const element = parent.ownerDocument.createElement(tag);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function drawPattern(document, layers) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Spinnvill-mønster sett ovenfra");
  svg.style.cssText = "display:block;width:100%;height:min(72vw,360px);margin-block:.4rem";
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const layer of layers) {
    const coordinates = [];
    for (const path of layer.paths) {
      for (const [index, [x, y]] of path.entries()) {
        const top = -y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, top);
        maxY = Math.max(maxY, top);
        coordinates.push((index === 0 ? "M" : "L") + x.toFixed(4) + "," + top.toFixed(4));
      }
    }
    const curve = document.createElementNS(SVG_NS, "path");
    curve.setAttribute("d", coordinates.join(" "));
    curve.setAttribute("fill", "none");
    curve.setAttribute("stroke", layer.color);
    curve.setAttribute("stroke-width", layer.mask ? ".75" : "1");
    curve.setAttribute("stroke-linecap", "round");
    curve.setAttribute("stroke-linejoin", "round");
    curve.setAttribute("vector-effect", "non-scaling-stroke");
    if (layer.mask) {
      curve.setAttribute("opacity", ".6");
      curve.setAttribute("stroke-dasharray", "3 2");
    }
    svg.append(curve);
  }
  const span = Math.max(1, maxX - minX, maxY - minY);
  const pad = span * .06;
  svg.setAttribute("viewBox", [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad].join(" "));
  return svg;
}

function start(api) {
  async function readPattern(source) {
    let text = source.trim();
    if (!text.startsWith("{")) {
      const file = text.split("/");
      const safe = text.toLowerCase().endsWith(".json") &&
        file.every(part => part && !part.startsWith(".") && !/[\\:\r\n\0]/.test(part));
      if (!safe) throw new Error("Bruk et PatternSpec-objekt eller en .json-fil relativt til vaultet.");
      const data = await api.vault.read(text);
      if (data === null) throw new Error("Fant ikke JSON-filen i vaultet.");
      text = data.trim();
    }
    if (new TextEncoder().encode(text).length > 128 * 1024) {
      throw new Error("Mønsterfilen kan være opptil 128 KiB.");
    }
    return JSON.parse(text);
  }

  api.markdown.registerCodeBlockProcessor(LANGUAGE, (source, container) => {
    const panel = createElement(container, "section");
    panel.style.cssText = "min-width:0;padding:.65rem;background:#f3f5f6;color:#182631;border-radius:.5rem;white-space:normal";
    const button = createElement(panel, "button", "Vis Spinnvill-mønster");
    button.type = "button";
    button.style.cssText = "min-height:2.5rem;padding:.4rem .7rem;cursor:pointer";
    const status = createElement(panel, "p");
    status.setAttribute("role", "status");
    status.style.cssText = "margin:.4rem 0 0;overflow-wrap:anywhere";
    let disposed = false;
    let image;

    async function show() {
      button.disabled = true;
      status.textContent = "Tegner mønster …";
      try {
        const spec = await readPattern(source);
        // Paint the loading state before the engine builds the vector paths.
        await new Promise(resolve => setTimeout(resolve, 24));
        if (disposed) return;
        const doc = panel.ownerDocument;
        const output = await SpinnvillPatternsEngine.preview(spec);
        if (disposed) return;
        const svg = drawPattern(doc, output.layers);
        image?.remove();
        panel.append(svg);
        image = svg;
        const [minX, minY] = output.generated.min;
        const [maxX, maxY] = output.generated.max;
        const format = value => value.toLocaleString("nb-NO", { maximumFractionDigits: 2 });
        status.textContent = format(maxX - minX) + " × " + format(maxY - minY) + " mm · " +
          format(output.generated.points) + " punkter";
        button.textContent = "Oppdater mønster";
      } catch (error) {
        if (disposed) return;
        image?.remove();
        image = undefined;
        status.textContent = String(error?.message || error).slice(0, 350);
      } finally {
        if (!disposed) button.disabled = false;
      }
    }

    button.addEventListener("click", show);
    return () => {
      disposed = true;
      button.removeEventListener("click", show);
      panel.remove();
    };
  });

  const commands = [
    { id: "insert-example", name: "Sett inn Spinnvill-eksempel", content: EXAMPLE_JSON },
    { id: "insert-file", name: "Sett inn referanse til Spinnvill-JSON", content: "spinnvill-turbin.json" },
  ];
  let registered = false;
  function updateCommands() {
    const canInsert = Boolean(api.app.currentFile);
    if (registered === canInsert) return;
    registered = canInsert;
    for (const { id, name, content } of commands) {
      if (canInsert) {
        api.ui.addCommand({
          id, name,
          callback() {
            if (!api.app.currentFile || api.editor.getContent() === null) return;
            const fence = "```";
            api.editor.insertAtCursor("\n\n" + fence + LANGUAGE + "\n" + content + "\n" + fence + "\n\n");
          },
        });
      } else {
        api.ui.removeCommand(id);
      }
    }
  }
  const events = ["plugin-loaded", "file-open", "layout-change"];
  for (const event of events) api.events.on(event, updateCommands);
  return () => {
    for (const event of events) api.events.off(event, updateCommands);
  };
}

let cleanup;
module.exports = {
  onLoad(api) { cleanup = start(api); },
  onUnload() { cleanup?.(); },
};
