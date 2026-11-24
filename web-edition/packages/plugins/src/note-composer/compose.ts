/** Note composer: merge notes into one, split one by headings. Moved unchanged from `lib/note-composer-utils.ts`. */

export function sanitizeFileName(heading: string): string {
  return (
    heading
      .replace(/[<>:"/\\|?*#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200) || "Untitled"
  );
}

export function mergeNotes(contents: { name: string; content: string }[], addHeadings: boolean): string {
  const parts: string[] = [];
  for (const { name, content } of contents) {
    if (addHeadings) {
      parts.push(`## ${name.replace(/\.(md|markdown)$/i, "")}`);
      parts.push("");
    }
    parts.push(content.trim());
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export function splitByHeadings(content: string, level: number): { title: string; content: string }[] {
  const lines = content.split("\n");
  const prefix = "#".repeat(level) + " ";
  const sections: { title: string; content: string }[] = [];

  let currentTitle = "";
  let currentLines: string[] = [];
  let foundFirst = false;

  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(prefix + "#")) {
      if (foundFirst) {
        sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
      } else if (currentLines.some((l) => l.trim() !== "")) {
        sections.push({ title: "Preamble", content: currentLines.join("\n").trim() });
      }
      currentTitle = line.slice(prefix.length).trim();
      currentLines = [line];
      foundFirst = true;
    } else {
      currentLines.push(line);
    }
  }

  if (foundFirst) {
    sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
  } else if (currentLines.some((l) => l.trim() !== "")) {
    sections.push({ title: "Untitled", content: currentLines.join("\n").trim() });
  }

  return sections;
}

/** Path of a split section, next to the note it came from. */
export function sectionPath(folder: string, title: string): string {
  const name = `${sanitizeFileName(title)}.md`;
  return folder ? `${folder}/${name}` : name;
}
