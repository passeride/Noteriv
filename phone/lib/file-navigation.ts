export type FileDestination = { path: string; heading?: string; line?: string; fileForward?: string };
type Frame = { key: string; fileForward?: string };

export class FileForwardHistory {
  private anchor?: Frame;
  private entries: FileDestination[] = [];
  private sequence = 0;

  private matches(frame: Frame) {
    return this.anchor?.key === frame.key ||
      (!!this.anchor?.fileForward && this.anchor.fileForward === frame.fileForward);
  }

  back(from: Frame, to: Frame, destination: FileDestination) {
    this.entries = [destination, ...(this.matches(from) ? this.entries : [])];
    this.anchor = to;
  }

  forward(frame: Frame): FileDestination | undefined {
    if (!this.matches(frame)) return;
    const destination = this.entries.shift();
    if (!destination) return;
    const fileForward = String(++this.sequence);
    this.anchor = { key: '', fileForward };
    return { ...destination, fileForward };
  }

  clear() {
    this.anchor = undefined;
    this.entries = [];
  }
}

export function fileSwipeAction(x: number, width: number, dx: number, dy: number, edgesOnly: boolean) {
  'worklet';
  if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  const edge = Math.min(76, width * 0.24);
  if (dx > 0) return !edgesOnly || x <= edge ? 'files' : null;
  if (x >= width - edge) return 'forward';
  return edgesOnly ? null : 'commands';
}
