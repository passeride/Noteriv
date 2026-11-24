import type { AiContextRef } from "./ai-types";

/**
 * Injects structured context XML references into user prompts.
 * Follows Claudian's Zero Context Bloat philosophy:
 * Sends vault overview map, pointers, active note content, and selections so the AI
 * has comprehensive understanding of the whole vault with minimal token overhead.
 */
export function buildPromptWithContext(userPrompt: string, context?: AiContextRef): string {
  if (!context) return userPrompt;

  const parts: string[] = [];

  if (context.vaultOverview) {
    const vo = context.vaultOverview;
    const nameAttr = vo.name ? ` name="${escapeXml(vo.name)}"` : "";
    const partsVo: string[] = [];
    partsVo.push(`  <vault_overview${nameAttr} total_notes="${vo.totalNotes}">`);
    if (vo.folders && vo.folders.length > 0) {
      partsVo.push("    <folders>");
      for (const folder of vo.folders) {
        partsVo.push(`      <folder path="${escapeXml(folder)}" />`);
      }
      partsVo.push("    </folders>");
    }
    if (vo.notes && vo.notes.length > 0) {
      partsVo.push("    <notes>");
      for (const note of vo.notes) {
        const nAttr = note.name ? ` name="${escapeXml(note.name)}"` : "";
        partsVo.push(`      <note path="${escapeXml(note.path)}"${nAttr} />`);
      }
      partsVo.push("    </notes>");
    }
    partsVo.push("  </vault_overview>");
    parts.push(partsVo.join("\n"));
  }

  if (context.activeNote) {
    const titleAttr = context.activeNote.title ? ` title="${escapeXml(context.activeNote.title)}"` : "";
    if (context.activeNote.content !== undefined && context.activeNote.content !== null) {
      parts.push(
        `  <active_note path="${escapeXml(context.activeNote.path)}"${titleAttr}>\n<![CDATA[\n${context.activeNote.content}\n]]>\n  </active_note>`
      );
    } else {
      parts.push(`  <active_note path="${escapeXml(context.activeNote.path)}"${titleAttr} />`);
    }
  }

  if (context.selection) {
    const linesAttr =
      context.selection.startLine !== undefined && context.selection.endLine !== undefined
        ? ` lines="${context.selection.startLine}-${context.selection.endLine}"`
        : "";
    parts.push(
      `  <editor_selection path="${escapeXml(context.selection.path)}"${linesAttr}>\n<![CDATA[${context.selection.text}]]>\n  </editor_selection>`
    );
  }

  if (context.mentionedNotes && context.mentionedNotes.length > 0) {
    parts.push("  <mentioned_notes>");
    for (const note of context.mentionedNotes) {
      const titleAttr = note.title ? ` title="${escapeXml(note.title)}"` : "";
      if (note.content !== undefined && note.content !== null) {
        parts.push(
          `    <note path="${escapeXml(note.path)}"${titleAttr}>\n<![CDATA[\n${note.content}\n]]>\n    </note>`
        );
      } else {
        parts.push(`    <note path="${escapeXml(note.path)}"${titleAttr} />`);
      }
    }
    parts.push("  </mentioned_notes>");
  }

  if (context.cursor) {
    parts.push(`  <editor_cursor path="${escapeXml(context.cursor.path)}" line="${context.cursor.line}" />`);
  }

  if (parts.length === 0) return userPrompt;

  return `${userPrompt.trim()}\n\n<context>\n${parts.join("\n")}\n</context>`;
}

/**
 * Extracts context XML block from prompt string if present, returning clean prompt and parsed context.
 */
export function parsePromptContext(rawPrompt: string): {
  cleanPrompt: string;
  context: AiContextRef;
} {
  const match = rawPrompt.match(/<context>([\s\S]*?)<\/context>/);
  if (!match) {
    return { cleanPrompt: rawPrompt, context: {} };
  }

  const cleanPrompt = rawPrompt.replace(/<context>[\s\S]*?<\/context>/, "").trim();
  const contextXml = match[1];
  const context: AiContextRef = {};

  // Vault overview
  const vaultMatch = contextXml.match(
    /<vault_overview(?:\s+name="([^"]*)")?\s+total_notes="(\d+)">([\s\S]*?)<\/vault_overview>/
  );
  if (vaultMatch) {
    const voName = vaultMatch[1] ? unescapeXml(vaultMatch[1]) : undefined;
    const totalNotes = parseInt(vaultMatch[2], 10);
    const inner = vaultMatch[3];
    const folders: string[] = [];
    const folderMatches = inner.matchAll(/<folder\s+path="([^"]+)"\s*\/>/g);
    for (const fm of folderMatches) {
      folders.push(unescapeXml(fm[1]));
    }
    const notes: Array<{ path: string; name?: string }> = [];
    const noteMatches = inner.matchAll(/<note\s+path="([^"]+)"(?:\s+name="([^"]*)")?\s*\/>/g);
    for (const nm of noteMatches) {
      notes.push({
        path: unescapeXml(nm[1]),
        name: nm[2] ? unescapeXml(nm[2]) : undefined,
      });
    }
    context.vaultOverview = {
      name: voName,
      totalNotes,
      folders: folders.length > 0 ? folders : undefined,
      notes: notes.length > 0 ? notes : undefined,
    };
  }

  // Active note (supports both self-closing and CDATA content)
  const activeNoteMatch =
    contextXml.match(/<active_note\s+path="([^"]+)"(?:\s+title="([^"]*)")?>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/active_note>/) ||
    contextXml.match(/<active_note\s+path="([^"]+)"(?:\s+title="([^"]*)")?\s*\/>/);
  if (activeNoteMatch) {
    context.activeNote = {
      path: unescapeXml(activeNoteMatch[1]),
      title: activeNoteMatch[2] ? unescapeXml(activeNoteMatch[2]) : undefined,
      content: activeNoteMatch[3] !== undefined ? activeNoteMatch[3].trim() : undefined,
    };
  }

  // Selection
  const selectionMatch = contextXml.match(
    /<editor_selection\s+path="([^"]+)"(?:\s+lines="(\d+)-(\d+)")?>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/editor_selection>/
  );
  if (selectionMatch) {
    context.selection = {
      path: unescapeXml(selectionMatch[1]),
      startLine: selectionMatch[2] ? parseInt(selectionMatch[2], 10) : undefined,
      endLine: selectionMatch[3] ? parseInt(selectionMatch[3], 10) : undefined,
      text: selectionMatch[4],
    };
  }

  // Mentioned notes
  const mentionsBlock = contextXml.match(/<mentioned_notes>([\s\S]*?)<\/mentioned_notes>/);
  if (mentionsBlock) {
    const notes: Array<{ path: string; title?: string; content?: string }> = [];
    const fullMatches = mentionsBlock[1].matchAll(
      /<note\s+path="([^"]+)"(?:\s+title="([^"]*)")?>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/note>/g
    );
    for (const m of fullMatches) {
      notes.push({
        path: unescapeXml(m[1]),
        title: m[2] ? unescapeXml(m[2]) : undefined,
        content: m[3] ? m[3].trim() : undefined,
      });
    }
    const simpleMatches = mentionsBlock[1].matchAll(/<note\s+path="([^"]+)"(?:\s+title="([^"]*)")?\s*\/>/g);
    for (const m of simpleMatches) {
      if (!notes.some((n) => n.path === unescapeXml(m[1]))) {
        notes.push({
          path: unescapeXml(m[1]),
          title: m[2] ? unescapeXml(m[2]) : undefined,
        });
      }
    }
    if (notes.length > 0) {
      context.mentionedNotes = notes;
    }
  }

  // Cursor
  const cursorMatch = contextXml.match(/<editor_cursor\s+path="([^"]+)"\s+line="(\d+)"\s*\/>/);
  if (cursorMatch) {
    context.cursor = {
      path: unescapeXml(cursorMatch[1]),
      line: parseInt(cursorMatch[2], 10),
    };
  }

  return { cleanPrompt, context };
}

/**
 * Builds standard system prompt for Noteriv AI Assistant.
 */
export function buildSystemPrompt(options?: {
  customInstructions?: string;
  memoryContent?: string;
  vaultName?: string;
}): string {
  const parts: string[] = [
    "Bạn là Noteriv AI, trợ lý tri thức thông minh chuyên biệt cho sổ tay ghi chú Markdown (Vault).",
    "Bạn nắm bắt toàn bộ bối cảnh và cấu trúc của Vault thông qua khối thẻ XML `<context>` đính kèm trong câu hỏi:",
    "- Thẻ `<vault_overview>`: Cung cấp bức tranh toàn cảnh gồm tên Vault, tổng số ghi chú, danh sách các thư mục, và toàn bộ file trong Vault. Khi người dùng hỏi về số lượng ghi chú, danh mục, cơ cấu thư mục hay các chủ đề có trong vault, hãy sử dụng thông tin trong thẻ này để trả lời đầy đủ, chính xác và trực tiếp.",
    "- Thẻ `<active_note>`: Chứa file ghi chú hiện tại đang mở trên màn hình cùng toàn bộ nội dung của nó.",
    "- Thẻ `<mentioned_notes>`: Chứa các ghi chú liên quan hoặc được người dùng nhắc đến bằng cú pháp `@tên` hoặc `[[tên]]`.",
    "- Giữ nguyên định dạng Markdown, frontmatter YAML và liên kết nội bộ `[[tên ghi chú]]`.",
    "- Luôn trả lời súc tích, chuyên nghiệp, chính xác và thân thiện bằng tiếng Việt.",
  ];

  if (options?.vaultName?.trim()) {
    parts.push(`Tên Vault hiện tại: ${options.vaultName.trim()}`);
  }

  if (options?.customInstructions?.trim()) {
    parts.push(`\nUser Custom Instructions:\n${options.customInstructions.trim()}`);
  }

  if (options?.memoryContent?.trim()) {
    parts.push(`\nLong-term Vault Memory (.noteriv/MEMORY.md):\n${options.memoryContent.trim()}`);
  }

  return parts.join("\n");
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(safe: string): string {
  return safe
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
