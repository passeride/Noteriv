import type { FileEntry } from '@/types';
import { vaultRelativePath } from '@/lib/sync-state';

export function fileDrawerScroll(
  files: FileEntry[], vaultPath: string, selectedKey: string | undefined, savedOffset: number, stride: number,
) {
  const selectedIndex = selectedKey === undefined ? -1 : files.findIndex(file =>
    !file.isDirectory && vaultRelativePath(vaultPath, file.path) === selectedKey);
  const offset = selectedIndex < 0 && Number.isFinite(savedOffset)
    ? Math.min(Math.max(0, savedOffset), Math.max(0, (files.length - 1) * stride))
    : 0;
  const index = selectedIndex >= 0 ? Math.max(0, selectedIndex - 1) : Math.floor(offset / stride);
  return { offset, index };
}
