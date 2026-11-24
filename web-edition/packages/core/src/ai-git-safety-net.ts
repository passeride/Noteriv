import type { VaultAdapter } from "./vault-adapter";
import { toPosixPath } from "./vault-adapter";

export interface SafetySnapshot {
  id: string;
  notePath: string;
  content: string;
  timestamp: number;
  reason: string;
  gitCommitHash?: string;
}

/**
 * Git Safety Net:
 * Manages pre-edit atomic snapshots and 1-click rollback before any AI agent modifies notes.
 * Inspired by JAVIS OS Git safety protocol.
 */
export class GitSafetyNet {
  private snapshots: SafetySnapshot[] = [];
  private idCounter = 1;

  /**
   * Save a snapshot of a note before it is changed.
   */
  async recordSnapshot(
    notePath: string,
    content: string,
    reason: string = "pre-ai-edit"
  ): Promise<SafetySnapshot> {
    const posix = toPosixPath(notePath);
    const snapshot: SafetySnapshot = {
      id: `snap-${Date.now()}-${this.idCounter++}`,
      notePath: posix,
      content,
      timestamp: Date.now(),
      reason,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Roll back a note to a recorded snapshot.
   */
  async rollback(snapshotId: string, adapter: VaultAdapter): Promise<boolean> {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return false;

    // Resolve ref or write directly
    const notes = await adapter.listNotes();
    const found = notes.find((n) => n.path === snapshot.notePath);
    const targetId = found ? found.id : snapshot.notePath;

    await adapter.writeNote(targetId, snapshot.content);
    return true;
  }

  /**
   * List all snapshots, optionally filtered by note path.
   */
  listSnapshots(notePath?: string): SafetySnapshot[] {
    if (!notePath) return [...this.snapshots];
    const posix = toPosixPath(notePath);
    return this.snapshots.filter((s) => s.notePath === posix);
  }

  /**
   * Get the most recent snapshot for a note.
   */
  getLatestSnapshot(notePath: string): SafetySnapshot | null {
    const matching = this.listSnapshots(notePath);
    if (matching.length === 0) return null;
    return matching[matching.length - 1];
  }
}

/**
 * Wraps any VaultAdapter with GitSafetyNet protection.
 * Automatically takes a pre-edit snapshot whenever writeNote is called on an existing note.
 */
export function wrapAdapterWithSafetyNet(
  adapter: VaultAdapter,
  safetyNet: GitSafetyNet
): VaultAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === "writeNote") {
        return async (id: string, content: string) => {
          try {
            const currentContent = await target.readNote(id);
            if (currentContent !== null) {
              const notes = await target.listNotes();
              const found = notes.find((n) => n.id === id);
              const path = found ? found.path : id;
              await safetyNet.recordSnapshot(path, currentContent, `pre-ai-write:${path}`);
            }
          } catch {
            // Note may not exist yet (creating new note)
          }
          return target.writeNote(id, content);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}
