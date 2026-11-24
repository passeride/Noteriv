import type { NoteBacklink, NoteRef, NoteSearchHit, VaultAdapter } from "@noteriv/core/vault-adapter";
import { ApiError, apiErrorCode, webApi, type ApiBacklink, type ApiNoteSummary } from "./webApi";
import { contentHash } from "./content-hash";

const toRef = (n: { id: string; name: string; path: string }): NoteRef => ({ id: n.id, name: n.name, path: n.path });

/** Split `dir/sub/name.md` into its folder path and file name. */
function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

/**
 * VaultAdapter over the REST API. Note ids are server ids. Creating a note creates any missing folders on its path,
 * like the filesystem does on desktop (a daily note in `Daily/` works in a vault that has no `Daily` folder yet);
 * rename only accepts a destination folder that already exists.
 */
export function createWebVaultAdapter(vaultId: string): VaultAdapter {
  /** An attachment target is its download URL (`/api/v1/vaults/<v>/attachments/<id>/download`) or, in older documents, its id. */
  const attachmentIdOf = (target: string) => target.match(/\/attachments\/([^/?#]+)\/download/)?.[1] ?? target;
  const attachmentDownloadUrl = (target: string) =>
    /^(https?:|\/|data:|blob:)/.test(target) ? target : webApi.attachments.downloadUrl(vaultId, target);

  async function folderIdFor(dir: string, create = false): Promise<string | null> {
    if (!dir) return null;
    const index = await webApi.vaults.index(vaultId);
    const existing = index.folders.find((f) => f.path === dir);
    if (existing) return existing.id;
    if (!create) throw new Error(`Folder does not exist: ${dir}`);
    // Create the chain from the top, reusing the parts that exist.
    let parentId: string | null = null;
    let path = "";
    for (const name of dir.split("/")) {
      path = path ? `${path}/${name}` : name;
      const found = index.folders.find((f) => f.path === path);
      parentId = found ? found.id : (await webApi.folders.create(vaultId, { name, parentId })).id;
    }
    return parentId;
  }

  return {
    kind: "web",

    async listNotes() {
      const index = await webApi.vaults.index(vaultId);
      return index.notes.map((n: ApiNoteSummary) => toRef(n));
    },

    async readNote(id) {
      try {
        return (await webApi.notes.get(vaultId, id)).content;
      } catch {
        return null;
      }
    },

    async writeNote(id, content) {
      await webApi.notes.update(vaultId, id, { content });
    },

    async createNote(path, content = "") {
      const { dir, name } = splitPath(path);
      const folderId = await folderIdFor(dir, true);
      return toRef(await webApi.notes.create(vaultId, { name, folderId, content }));
    },

    async renameNote(id, newPath) {
      const { dir, name } = splitPath(newPath);
      const folderId = await folderIdFor(dir);
      return toRef(await webApi.notes.update(vaultId, id, { name, folderId }));
    },

    async deleteNote(id) {
      await webApi.notes.remove(vaultId, id);
    },

    async search(query): Promise<NoteSearchHit[]> {
      if (!query.trim()) return [];
      const hits = await webApi.vaults.search(vaultId, query);
      return hits.map((h) => ({ ref: toRef(h), snippet: h.snippet, matches: h.matches }));
    },

    // The server endpoint knows which notes link here but not where, so line and snippet stay unset.
    async backlinks(id): Promise<NoteBacklink[]> {
      const found: ApiBacklink[] = await webApi.notes.backlinks(vaultId, id);
      return found.map((b) => ({ ref: toRef(b) }));
    },

    // The server takes up to 200 terms per request (a renamed folder can move more notes than that). An answer cut at
    // the server's cap is reported as null: the caller then reads every note rather than miss some.
    async notesContaining(terms) {
      const byId = new Map<string, { ref: NoteRef; content: string }>();
      for (let i = 0; i < terms.length; i += 200) {
        const { notes, truncated } = await webApi.notes.containing(vaultId, terms.slice(i, i + 200));
        if (truncated) return null;
        for (const n of notes) byId.set(n.id, { ref: toRef(n), content: n.content });
      }
      return Array.from(byId.values());
    },

    async frontmatterHeads() {
      return (await webApi.notes.frontmatterHeads(vaultId)).map((n) => ({ ref: toRef(n), head: n.head }));
    },

    async readBatchNotes(options: { ids?: string[]; paths?: string[]; all?: boolean } = { all: true }) {
      if (options.all) {
        const res = await webApi.notes.batch(vaultId, { all: true });
        return res.notes.map((n) => ({ ref: toRef(n), content: n.content }));
      }
      if (options.ids && options.ids.length > 0) {
        const out: { ref: NoteRef; content: string }[] = [];
        for (let i = 0; i < options.ids.length; i += 200) {
          const chunk = options.ids.slice(i, i + 200);
          const res = await webApi.notes.batch(vaultId, { noteIds: chunk });
          out.push(...res.notes.map((n) => ({ ref: toRef(n), content: n.content })));
        }
        return out;
      }
      if (options.paths && options.paths.length > 0) {
        const out: { ref: NoteRef; content: string }[] = [];
        for (let i = 0; i < options.paths.length; i += 200) {
          const chunk = options.paths.slice(i, i + 200);
          const res = await webApi.notes.batch(vaultId, { paths: chunk });
          out.push(...res.notes.map((n) => ({ ref: toRef(n), content: n.content })));
        }
        return out;
      }
      return [];
    },

    async writeNoteIfUnchanged(id, content, expected) {
      const expectHash = await contentHash(expected);
      if (!expectHash) {
        // No WebCrypto (plain-http page): compare just before writing instead.
        if ((await webApi.notes.get(vaultId, id)).content !== expected) return false;
        await webApi.notes.update(vaultId, id, { content });
        return true;
      }
      try {
        await webApi.notes.update(vaultId, id, { content, expectHash });
        return true;
      } catch (err) {
        if (err instanceof ApiError && apiErrorCode(err) === "changed") return false;
        throw err;
      }
    },

    async noteDates() {
      const index = await webApi.vaults.index(vaultId);
      return Object.fromEntries(
        index.notes.map((n) => [n.id, { createdAt: Date.parse(n.createdAt), modifiedAt: Date.parse(n.updatedAt) }])
      );
    },

    // Attachments live in object storage, not in the note tree; the link is the download URL (same as the old recorder).
    async saveAttachment(name, data) {
      const file = new File([data], name, { type: data.type || "application/octet-stream" });
      const attachment = await webApi.attachments.upload(vaultId, file);
      return webApi.attachments.downloadUrl(vaultId, attachment.id);
    },

    // Snapshots come from a server job (~every 10 minutes while a note changes). Git history needs a git sync
    // connection that has synced at least once; the /history endpoint checks again and answers empty otherwise.
    async historySources() {
      const connections = await webApi.sync.list(vaultId).catch(() => []);
      return { snapshots: true, git: connections.some((c) => c.providerType !== "webdav" && !!c.lastSyncedAt) };
    },

    async noteSnapshots(id) {
      const snaps = await webApi.notes.snapshots(vaultId, id).catch(() => []);
      return snaps.map((s) => ({ id: s.id, timestamp: Date.parse(s.createdAt), size: s.size }));
    },

    async readNoteSnapshot(id, snapshotId) {
      try {
        return (await webApi.notes.snapshotContent(vaultId, id, snapshotId)).content;
      } catch {
        return null;
      }
    },

    async noteGitLog(id) {
      try {
        return (await webApi.notes.history(vaultId, id)).entries;
      } catch {
        return [];
      }
    },

    async readNoteAtCommit(id, hash) {
      try {
        return (await webApi.notes.historyAt(vaultId, id, hash)).content;
      } catch {
        return null;
      }
    },

    // Images for documents that embed them (Canvas): the target is the download URL, as saveAttachment returns.
    async listAttachments() {
      const { attachments } = await webApi.attachments.list(vaultId);
      return attachments
        .filter((a) => a.mimeType.startsWith("image/"))
        .map((a) => ({ target: webApi.attachments.downloadUrl(vaultId, a.id), name: a.filename }));
    },

    // A URL is shown as it is (same origin, the session cookie rides along); anything else is an attachment id, the
    // form canvases kept before 2.5b.
    async attachmentUrl(target) {
      return /^(https?:|\/|data:|blob:)/.test(target) ? target : webApi.attachments.downloadUrl(vaultId, target);
    },

    async readAttachment(target) {
      try {
        const res = await fetch(attachmentDownloadUrl(target));
        return res.ok ? await res.arrayBuffer() : null;
      } catch {
        return null;
      }
    },

    // Data kept with an attachment (PDF annotations) is the attachment row's `metadata`, read fresh each time.
    async getAttachmentData(target) {
      const id = attachmentIdOf(target);
      const { attachments } = await webApi.attachments.list(vaultId);
      return attachments.find((a) => a.id === id)?.metadata ?? null;
    },

    async setAttachmentData(target, data) {
      await webApi.attachments.updateMetadata(vaultId, attachmentIdOf(target), data);
    },

    async getSettings() {
      return (await webApi.vaults.get(vaultId)).settings ?? {};
    },

    async saveSettings(settings) {
      await webApi.vaults.update(vaultId, { settings });
    },
  };
}
