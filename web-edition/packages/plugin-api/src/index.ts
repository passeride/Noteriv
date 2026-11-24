/**
 * Noteriv Plugin API v1 — DRAFT (0.x, not frozen). Types only; there is no runtime code in this package.
 * Spec and rationale: docs/plugin-api/v1.md.
 *
 * Two tiers share this one surface:
 *  - core plugins: ES modules inside this repo, loaded with a dynamic import() and given real DOM;
 *  - community plugins: plain scripts run in a sandboxed iframe, where every call below is an RPC that the host
 *    checks against the permissions the user granted (see `PluginPermission`).
 *
 * Anything that hands back DOM (`registerView`, panels, modals) is only available to core plugins as written
 * here; the sandbox offers the mirrored-HTML subset that existed before v1 (see the spec, "Sandbox subset").
 */

export const PLUGIN_API_VERSION = "1.0.0-draft.11";

// ─── Permissions (community tier) ───

export type PluginPermission =
  | "vault:read"
  | "vault:write"
  | "editor:read"
  | "editor:write"
  | "ui:commands"
  | "ui:statusbar"
  | "ui:panel"
  | "markdown:render";

// ─── Vault ───

export interface VaultEntry {
  /** Vault-relative path, `/` separated. */
  path: string;
  name: string;
  isDir: boolean;
}

export interface NoteStats {
  /** Milliseconds since epoch. */
  createdAt: number;
  modifiedAt: number;
}

/** One saved past version of a note (Time scrubber): an automatic snapshot. */
export interface NoteSnapshot {
  id: string;
  /** Milliseconds since epoch. */
  timestamp: number;
  /** Bytes. */
  size: number;
}

/** One git commit that touched a note. */
export interface NoteCommit {
  hash: string;
  author: string;
  /** As git reports it (ISO 8601). */
  date: string;
  message: string;
}

/** Which kinds of past versions this vault keeps. */
export interface VersionSources {
  snapshots: boolean;
  git: boolean;
}

export interface AttachmentInfo {
  /** What to store in a document and pass to `attachmentUrl`: a URL on web, a vault path on desktop. */
  target: string;
  name: string;
}

export interface VaultApi {
  read(path: string): Promise<string | null>;
  /** Creates the note (and any missing folders) when it does not exist. */
  write(path: string, content: string): Promise<boolean>;
  list(dir?: string): Promise<VaultEntry[]>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<boolean>;
  /**
   * Core tier only. Changes a note's text with `transform` (return null to leave it): through the note's open tab when
   * it has one (the tab shows the change and saves it), otherwise written only if the note did not change in between.
   * Resolves to whether the note changed. Prefer it to `write` for editing a note the user may have open.
   */
  edit(path: string, transform: (text: string) => string | null): Promise<boolean>;
  /** Core tier only. The front matter block (`---` … `---`) of every note that has one, with the note's path. */
  frontmatter(): Promise<{ path: string; block: string }[]>;
  /** Core tier only. Creation / last-change time of every note, keyed by vault-relative path (absent: unknown). */
  stats(): Promise<Record<string, NoteStats>>;
  /** Core tier only. Reads multiple notes by path in batch, returning a map of path -> content. */
  readBatch?(paths: string[]): Promise<Record<string, string>>;
  /** Core tier only. Reads all notes in the vault in batch (Bug #5). */
  readAll?(): Promise<{ path: string; content: string }[]>;
  /**
   * Core tier only. Stores a binary attachment (a recording, an image…) under `name` and returns the link target to
   * put in markdown (`![Audio](target)`): an attachment URL on web, `attachments/<name>` inside the vault on desktop.
   */
  saveAttachment(name: string, data: Blob): Promise<string>;
  /** Core tier only. Which history sources exist (web: git only with a git sync connection that has run). */
  versionSources(): Promise<VersionSources>;
  /** Core tier only. Snapshots of a note, newest first (empty when there are none). */
  snapshots(path: string): Promise<NoteSnapshot[]>;
  readSnapshot(path: string, id: string): Promise<string | null>;
  /** Core tier only. Commits that touched a note, newest first (empty without git history). */
  gitLog(path: string): Promise<NoteCommit[]>;
  readAtCommit(path: string, hash: string): Promise<string | null>;
  /**
   * Core tier only. The vault path of the note a stored reference points at: a vault path, or what older documents
   * kept (a web note id, a desktop absolute path). Null when no such note exists.
   */
  resolve(ref: string): Promise<string | null>;
  /** Core tier only. Images stored in the vault, each with the target to keep in a document (as `saveAttachment`). */
  listAttachments(): Promise<AttachmentInfo[]>;
  /** Core tier only. A URL an `<img>` can show for an attachment target (a `data:` URL on desktop). */
  attachmentUrl(target: string): Promise<string | null>;
  /** Core tier only. The bytes of an attachment (a PDF…), from any target `attachmentUrl` accepts. Null if unreadable. */
  readAttachment(target: string): Promise<ArrayBuffer | null>;
  /**
   * Core tier only. JSON a plugin keeps with one attachment (PDF annotations): web stores it on the attachment, desktop
   * in a hidden file next to it (`.<name>-annotations.json`). Null when there is none.
   */
  getAttachmentData(target: string): Promise<unknown>;
  setAttachmentData(target: string, data: unknown): Promise<void>;
}

// ─── Editor ───

export interface CursorPosition {
  line: number;
  ch: number;
}

export interface EditorApi {
  getContent(): string | null;
  setContent(content: string): void;
  insertAtCursor(text: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  getCursorPosition(): CursorPosition;
  /** Core tier only. Moves the cursor (0-based, clamped to the document), scrolls it into view and focuses the editor. */
  setCursor(pos: CursorPosition): void;
}

// ─── Markdown ───

export interface CodeBlockProcessorContext {
  source: string;
  language: string;
  sourcePath: string | null;
}

/** May return a cleanup function, called when the block is re-rendered or removed. */
export type CodeBlockProcessor = (
  source: string,
  el: HTMLElement,
  ctx: CodeBlockProcessorContext
) => void | (() => void);

export interface PostProcessorContext {
  sourcePath: string | null;
}

/** Runs over the rendered DOM of a note (reading view / publish preview). Core tier only. */
export type MarkdownPostProcessor = (el: HTMLElement, ctx: PostProcessorContext) => void;

export interface MarkdownApi {
  registerCodeBlockProcessor(language: string, processor: CodeBlockProcessor): void;
  unregisterCodeBlockProcessor(language: string): void;
  /** Core tier only. */
  registerPostProcessor(processor: MarkdownPostProcessor): void;
  /**
   * Core tier only. Shows `source` read-only in `el` the way the editor draws it (live preview); returns the cleanup.
   * The host may render asynchronously.
   */
  renderReadOnly(source: string, el: HTMLElement): () => void;
}

// ─── UI ───

export interface PluginCommand {
  /** Unique within the plugin; the host namespaces it as `<pluginId>:<id>`. */
  id: string;
  name: string;
  icon?: string;
  /** Accelerator such as `Mod+Shift+W`. `Mod` is Ctrl on Windows/Linux and Cmd on macOS. */
  hotkey?: string;
  callback(): void | Promise<void>;
}

export interface StatusBarItem {
  id: string;
  text: string;
  title?: string;
  onClick?: () => void;
}

export interface RibbonIcon {
  id: string;
  title: string;
  /** Icon name from the host's icon set, or an inline `<svg>` string. */
  icon?: string;
  onClick(): void;
}

/** A button on the open note's toolbar (web). Hosts without a note toolbar (desktop) do not show it. */
export interface NoteToolbarButton {
  id: string;
  title: string;
  /** Inline `<svg>` string or a short text label. */
  icon: string;
  onClick(): void;
}

export interface SidebarPanel {
  id: string;
  title: string;
  icon: string;
  render(container: HTMLElement): void | (() => void);
}

export interface SettingsTab {
  id: string;
  name: string;
  render(container: HTMLElement): void | (() => void);
}

/** A whole-tab view (Canvas, Board, a chess board…). Core tier only. */
export interface ViewHandle {
  /** Called with the tab's content element; return value is the cleanup. */
  mount(container: HTMLElement, state: ViewState): void | (() => void);
}

export interface ViewState {
  /** Vault-relative path the view was opened for, if any. */
  path: string | null;
}

export type ViewFactory = () => ViewHandle;

/** What a file view is given for one tab (one pane) showing one file. */
export interface FileViewContext {
  /** Vault-relative path of the file. */
  path: string;
  /** The tab's content when the view was mounted. */
  content: string;
  /** Writes into the tab's buffer, exactly like typing in the editor: dirty marker, save, auto-save, collaboration. */
  setContent(content: string): void;
}

export interface FileViewInstance {
  /** The tab's content changed elsewhere (edited in source mode, changed on disk, a collaborator). Never called with
   * the content this view itself just passed to `setContent`. */
  update?(content: string): void;
  destroy?(): void;
}

/** What an attachment viewer is given: the attachment, and a way to close the viewer (a tab, or an overlay). */
export interface AttachmentViewerContext {
  /** The attachment's target, as `vault.attachmentUrl`/`readAttachment` take it (web: download URL; desktop: vault path). */
  target: string;
  /** File name, for titles and exports. */
  name: string;
  close(): void;
}

/**
 * Shows attachments it recognises (a PDF reader…). Core tier only. Desktop shows it in the file's tab; web over the page
 * when the attachment is opened from the Attachments dialog. Not text: the viewer reads through `vault.readAttachment`.
 */
export interface AttachmentViewer {
  /** Unique within the plugin. */
  id: string;
  match(file: { target: string; name: string }): boolean;
  /** Returns the cleanup. */
  mount(container: HTMLElement, ctx: AttachmentViewerContext): void | (() => void);
}

/**
 * A view that replaces the editor for files it recognises (a Kanban board, later Canvas, Drawing…). Core tier only.
 * It shows inside the tab, in the main and the split pane alike, one instance per pane. Source mode always shows the
 * plain editor, so the file can still be edited as text.
 */
export interface FileView {
  /** Unique within the plugin. */
  id: string;
  /** Whether this view shows the file. Called often (every render of a tab): keep it cheap. */
  match(file: { path: string; content: string }): boolean;
  mount(container: HTMLElement, ctx: FileViewContext): FileViewInstance | void;
}

export interface UiApi {
  addCommand(cmd: PluginCommand): void;
  removeCommand(id: string): void;
  addStatusBarItem(item: StatusBarItem): void;
  removeStatusBarItem(id: string): void;
  addSidebarPanel(panel: SidebarPanel): void;
  removeSidebarPanel(id: string): void;
  /** Core tier only. Shows the panel (in the right column) or hides it if it is shown. */
  toggleSidebarPanel(id: string): void;
  addSettingsTab(tab: SettingsTab): void;
  removeSettingsTab(id: string): void;
  showNotice(message: string, durationMs?: number): void;
  /** Core tier only. Registers a view type that `workspace.openView` can open in a tab. */
  registerView(type: string, factory: ViewFactory): void;
  unregisterView(type: string): void;
  /** Core tier only. */
  addRibbonIcon(icon: RibbonIcon): void;
  removeRibbonIcon(id: string): void;
  /**
   * Core tier only. Adds a button to the open note's toolbar. Not every host has one (desktop does not), so a plugin
   * also offers the action as a command.
   */
  addNoteToolbarButton(button: NoteToolbarButton): void;
  removeNoteToolbarButton(id: string): void;
  /** Core tier only. Shows files this view `match`es with it instead of the editor (see `FileView`). */
  registerFileView(view: FileView): void;
  unregisterFileView(id: string): void;
  /** Core tier only. Shows attachments this viewer `match`es (see `AttachmentViewer`). */
  registerAttachmentViewer(viewer: AttachmentViewer): void;
  unregisterAttachmentViewer(id: string): void;
}

// ─── Events ───

export type PluginEvent =
  | "file-open"
  | "file-save"
  | "file-create"
  | "file-delete"
  | "editor-change"
  | "vault-change"
  | "layout-change"
  | "plugin-loaded"
  | "plugin-unloaded";

export interface EventsApi {
  on(event: PluginEvent, handler: (...args: any[]) => void): void;
  off(event: PluginEvent, handler: (...args: any[]) => void): void;
  emit(event: PluginEvent, ...args: any[]): void;
}

// ─── Workspace, settings, app ───

export interface WorkspaceApi {
  /** Open a note in a tab. Resolves false when the path does not exist. */
  openFile(path: string): Promise<boolean>;
  /** Core tier only. Open a view registered with `ui.registerView`. */
  openView(type: string, state?: ViewState): Promise<boolean>;
  /** Core tier only. Close the view this plugin has open, if any (e.g. after jumping to a note from it). */
  closeView(): void;
}

export interface SettingsApi {
  /** Per-plugin JSON blob, stored per vault. */
  load(): Promise<Record<string, unknown>>;
  save(data: Record<string, unknown>): Promise<void>;
}

export type PluginPlatform = "web" | "desktop";

export interface AppApi {
  /** Plugin API version (`PLUGIN_API_VERSION`). */
  version: string;
  platform: PluginPlatform;
  /** Absolute vault path on desktop, null on web. */
  vaultPath: string | null;
  currentFile: string | null;
  /** @deprecated Use `settings.load`. Kept so v0 community plugins keep working. */
  loadSettings(): Promise<Record<string, unknown>>;
  /** @deprecated Use `settings.save`. */
  saveSettings(data: Record<string, unknown>): Promise<void>;
}

/**
 * Core tier only. The app's language and its translation catalog: core plugins keep their text under
 * `plugins.<pluginId>.*` in the shared catalog (packages/ui/src/i18n/locales). After a language change the host
 * reloads every enabled core plugin, so text set once in `onload` (command names, ribbon titles) follows.
 */
export interface I18nApi {
  /** Current language, e.g. "en" or "vi". */
  readonly locale: string;
  /** Text for a catalog key; `{name}` is filled from `params`, plural forms are chosen with `params.count`. */
  t(key: string, params?: Record<string, string | number>): string;
}

// ─── The API object a plugin receives ───

export interface PluginApi {
  vault: VaultApi;
  editor: EditorApi;
  markdown: MarkdownApi;
  ui: UiApi;
  events: EventsApi;
  workspace: WorkspaceApi;
  settings: SettingsApi;
  app: AppApi;
  i18n: I18nApi;
}

// ─── Plugin module shapes ───

/** Default export of a core plugin module. */
export interface CorePlugin {
  onload(api: PluginApi): void | Promise<void>;
  /** Optional. Everything registered through `api` is removed by the host afterwards regardless. */
  onunload?(): void | Promise<void>;
}

/** Shape of a community plugin script's `module.exports`. */
export interface CommunityPluginExports {
  onLoad?(api: PluginApi): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** Entry script, relative to the plugin folder (community tier). */
  main: string;
  minAppVersion?: string;
  /** Fence languages the plugin renders; lets hosts load it lazily. */
  codeBlockLanguages?: string[];
  /** Community tier. When absent the host infers a proposal from the code and asks the user. */
  permissions?: PluginPermission[];
}
