import { native, nativeDir } from '@/lib/provider-sync';
import { dirExists, fileExists } from '@/lib/file-system';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import type { GitCommit, PathActivity } from '../../packages/git-client/path-history';

export function hasGitHistory(vault: string): boolean {
  const git = vaultFileUri(vault, '.git');
  return dirExists(git) || fileExists(git);
}

export function getFileHistory(vault: string, file: string): Promise<GitCommit[]> {
  return native({ action: 'fileHistory', dir: nativeDir(vault), path: vaultRelativePath(vault, file) });
}

export function getPathActivity(vault: string, folder = ''): Promise<PathActivity[]> {
  return native({ action: 'pathActivity', dir: nativeDir(vault), path: folder });
}
