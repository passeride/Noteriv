import type { PluginApi } from "@noteriv/plugin-api";
import { listMarkdown, noteTitle } from "../shared/vault";

/** Everything the canvas reads or opens outside its own document. */
export interface CanvasServices {
  /** Every note, for the "add note" picker. */
  notes(): Promise<{ path: string; name: string }[]>;
  /** A file node's note, from any reference it may hold (vault path, web note id, desktop absolute path). */
  note(ref: string): Promise<{ path: string; name: string; content: string } | null>;
  openNote(ref: string): void;
  /** Images already in the vault, for the image picker. */
  images(): Promise<{ target: string; name: string }[]>;
  /** A URL an `<img>` can show for an image node's target. */
  imageUrl(target: string): Promise<string | null>;
  /** Stores a picked file as an attachment; returns its target. */
  uploadImage(file: File): Promise<string>;
}

export interface CanvasLabels {
  searchNotes: string;
  noMatchingNotes: string;
  noteNotFound: string;
  pickImage: string;
  upload: string;
  uploading: string;
  noImages: string;
  loading: string;
  /** Default name of a new group. */
  group: string;
  // Toolbar
  select: string;
  addText: string;
  addSticky: string;
  addImage: string;
  addFile: string;
  addGroup: string;
  draw: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  zoomToFit: string;
  deleteSelected: string;
  /** Right-click menu. */
  menu: {
    duplicate: string;
    stickyColor: string;
    color: string;
    delete: string;
    addText: string;
    addSticky: string;
    addImage: string;
  };
}

export function pluginCanvasServices(api: PluginApi): CanvasServices {
  return {
    async notes() {
      return (await listMarkdown(api.vault)).map((path) => ({ path, name: noteTitle(path) }));
    },
    async note(ref) {
      const path = await api.vault.resolve(ref);
      if (!path) return null;
      const content = await api.vault.read(path);
      return content === null ? null : { path, name: noteTitle(path), content };
    },
    openNote(ref) {
      void api.vault.resolve(ref).then((path) => {
        if (path) void api.workspace.openFile(path);
      });
    },
    images: () => api.vault.listAttachments(),
    imageUrl: (target) => api.vault.attachmentUrl(target),
    uploadImage: (file) => api.vault.saveAttachment(file.name, file),
  };
}
