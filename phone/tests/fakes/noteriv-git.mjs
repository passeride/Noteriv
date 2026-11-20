import * as FS from './file-system.mjs';
let remote, base;
export function resetRemote() { remote = 'first version'; base = null; }
export function setRemoteNote(text) { remote = text; }
export function getRemoteNote() { return remote; }
export default {
  async execute(raw) {
    const { action, dir } = JSON.parse(raw);
    const file = 'file://' + dir + '/Note.md';
    const status = { isRepo: true, remote: 'https://git.example/me/notes', pulled: 0, pushed: 0, conflicts: [] };
    if (action === 'pull' || action === 'sync') {
      const local = await FS.readFile(file);
      if (remote !== base && local !== null && local !== base) {
        status.conflicts.push('Note.md');
        FS.writeFile('file://' + dir + '/Note (remote conflict).md', remote);
      } else if (remote !== base) {
        FS.writeFile(file, remote);
        base = remote;
        status.pulled = 1;
      } else if (action === 'sync' && local !== base) {
        remote = local;
        base = local;
        status.pushed = 1;
      }
    }
    return JSON.stringify({ ok: true, value: status });
  },
};
