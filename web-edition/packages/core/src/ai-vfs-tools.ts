import type { VaultAdapter, NoteRef } from "./vault-adapter";
import { toPosixPath, baseName } from "./vault-adapter";
import type { AiToolDefinition } from "./ai-types";

export interface VfsToolHandler {
  getToolDefinitions(): AiToolDefinition[];
  executeTool(name: string, args: Record<string, unknown>): Promise<any>;
}

export function createVfsTools(adapter: VaultAdapter): VfsToolHandler {
  const definitions: AiToolDefinition[] = [
    {
      name: "list_notes",
      description: "List notes in the vault, optionally filtered by folder prefix.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Optional folder path to filter notes by, e.g. 'Projects'.",
          },
          limit: {
            type: "number",
            description: "Maximum number of notes to return (default: 100).",
          },
        },
      },
    },
    {
      name: "read_note",
      description: "Read the full markdown content of a note by its vault-relative path.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative path to the note, e.g. 'Projects/Alpha.md'.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "search_notes",
      description: "Search notes across the vault by query text or keyword.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search keyword or text query.",
          },
          limit: {
            type: "number",
            description: "Maximum search hits to return (default: 20).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "create_note",
      description: "Create a new markdown note at the specified path with content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative path for the new note, e.g. 'Daily/2026-10-27.md'.",
          },
          content: {
            type: "string",
            description: "Initial markdown content of the note.",
          },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "patch_note",
      description: "Update or replace text inside an existing note.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative path to the note.",
          },
          oldText: {
            type: "string",
            description: "Exact text snippet to be replaced. If omitted, the entire content is replaced.",
          },
          newText: {
            type: "string",
            description: "New text to insert or replace with.",
          },
        },
        required: ["path", "newText"],
      },
    },
    {
      name: "get_backlinks",
      description: "Retrieve all notes linking to the target note via [[wikilinks]].",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative path or note name to find incoming links for.",
          },
        },
        required: ["path"],
      },
    },
  ];

  async function resolveRef(notePath: string): Promise<NoteRef> {
    const posix = toPosixPath(notePath);
    const notes = await adapter.listNotes();
    const found = notes.find((n) => n.path === posix || n.name === baseName(posix));
    if (!found) {
      throw new Error(`Note not found: ${notePath}`);
    }
    return found;
  }

  return {
    getToolDefinitions() {
      return definitions;
    },

    async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
      switch (name) {
        case "list_notes": {
          const folder = typeof args.folder === "string" ? toPosixPath(args.folder).replace(/^\/|\/$/g, "") : null;
          const limit = typeof args.limit === "number" ? args.limit : 100;
          const notes = await adapter.listNotes();
          const filtered = folder
            ? notes.filter((n) => n.path.startsWith(`${folder}/`))
            : notes;
          return {
            notes: filtered.slice(0, limit).map((n) => ({ path: n.path, name: n.name })),
          };
        }

        case "read_note": {
          const notePath = String(args.path);
          const ref = await resolveRef(notePath);
          const content = await adapter.readNote(ref.id);
          if (content === null) {
            throw new Error(`Note content could not be read: ${ref.path}`);
          }
          return { path: ref.path, content };
        }

        case "search_notes": {
          const query = String(args.query);
          const limit = typeof args.limit === "number" ? args.limit : 20;
          let hits: any[] = [];
          if (typeof (adapter as any).search === "function") {
            hits = await (adapter as any).search(query);
          } else if (typeof (adapter as any).searchNotes === "function") {
            hits = await (adapter as any).searchNotes(query);
          } else {
            // In-memory fallback
            const notes = await adapter.listNotes();
            const q = query.toLowerCase();
            for (const note of notes) {
              const content = await adapter.readNote(note.id);
              if (content && (content.toLowerCase().includes(q) || note.name.toLowerCase().includes(q))) {
                hits.push({ ref: note, snippet: content.slice(0, 150) });
              }
            }
          }
          return {
            results: hits.slice(0, limit).map((hit) => ({
              path: hit.ref.path,
              snippet: hit.snippet,
              matches: hit.matches,
            })),
          };
        }

        case "create_note": {
          const notePath = toPosixPath(String(args.path));
          const content = String(args.content);
          if (adapter.createNote) {
            await adapter.createNote(notePath, content);
          } else {
            await adapter.writeNote(notePath, content);
          }
          return { success: true, path: notePath };
        }

        case "patch_note": {
          const notePath = String(args.path);
          const ref = await resolveRef(notePath);
          const currentContent = await adapter.readNote(ref.id);
          if (currentContent === null) {
            throw new Error(`Note content could not be read: ${ref.path}`);
          }
          const oldText = typeof args.oldText === "string" ? args.oldText : null;
          const newText = String(args.newText);

          let nextContent: string;
          if (oldText !== null) {
            if (!currentContent.includes(oldText)) {
              throw new Error(`Target text to replace not found in note: "${oldText.slice(0, 50)}..."`);
            }
            nextContent = currentContent.replace(oldText, newText);
          } else {
            nextContent = newText;
          }

          await adapter.writeNote(ref.id, nextContent);
          return { success: true, path: ref.path };
        }

        case "get_backlinks": {
          const notePath = String(args.path);
          const ref = await resolveRef(notePath);
          let backlinks: any[] = [];
          if (typeof (adapter as any).backlinks === "function") {
            backlinks = await (adapter as any).backlinks(ref.id);
          } else if (typeof (adapter as any).backlinksTo === "function") {
            backlinks = await (adapter as any).backlinksTo(ref.id);
          }
          return {
            path: ref.path,
            backlinks: backlinks.map((b) => ({
              path: b.ref.path,
              line: b.line,
              snippet: b.snippet,
            })),
          };
        }

        default:
          throw new Error(`Unknown VFS tool: ${name}`);
      }
    },
  };
}
