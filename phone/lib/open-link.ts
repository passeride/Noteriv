import type { Vault } from '@/types';
import { resolveWikiLink } from '@/lib/wiki-links';

export type OpenLinkParams = {
  vault?: string;
  repo?: string;
  file?: string;
  heading?: string;
  line?: string;
  '#'?: string;
};

function repositoryKey(remote: string): string | undefined {
  const value = remote.trim();
  const scp = !value.includes('://') && /^(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/\\\s]+):([^\\]+)$/.exec(value);
  try {
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : value);
    const defaultPort = { 'https:': '443', 'http:': '80', 'ssh:': '22', 'git:': '9418' }[url.protocol];
    if (!defaultPort || !url.hostname) return;
    const host = url.hostname.toLowerCase();
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
    let path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
    if (host === 'github.com') path = path.toLowerCase();
    path = path.replace(/\.git$/, '');
    if (path) return `${host}${port}/${path}`;
  } catch {
    // A local path or unsupported URL cannot identify a Git remote.
  }
}

function findVault(params: OpenLinkParams, vaults: Vault[], activeVault: Vault | null): Vault {
  const repo = params.repo?.trim();
  if (repo) {
    const key = repositoryKey(repo);
    if (!key) throw new Error('This link does not contain a valid Git repository URL.');
    const matches = vaults.filter(vault => vault.gitRemote && repositoryKey(vault.gitRemote) === key);
    if (matches.length > 1) throw new Error('Several vaults use this repository. Open the link using a vault name or ID.');
    if (!matches.length) throw new Error('No vault on this device uses this Git repository.');
    return matches[0];
  }
  const name = params.vault?.trim();
  if (name) {
    const byId = vaults.find(vault => vault.id === name);
    if (byId) return byId;
    const matches = vaults.filter(vault => vault.name.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) throw new Error('Several vaults have this name. Open the link using a vault ID.');
    if (!matches.length) throw new Error('The vault in this link was not found on this device.');
    return matches[0];
  }
  if (!activeVault) throw new Error('Open a vault before following this link.');
  return activeVault;
}

export async function resolveOpenLink(params: OpenLinkParams, vaults: Vault[], activeVault: Vault | null) {
  const vault = findVault(params, vaults, activeVault);
  const rawFile = params.file?.trim();
  if (!rawFile) return { vault };

  const hash = rawFile.indexOf('#');
  const file = (hash < 0 ? rawFile : rawFile.slice(0, hash)).replace(/^\.\//, '').trim();
  if (!file || /[\\:\u0000-\u001f]/.test(file) || file.split('/').some(part => !part || part.startsWith('.'))) {
    throw new Error('The file in this link must be a note inside the vault.');
  }

  const heading = params.heading?.trim() || (hash < 0 ? undefined : rawFile.slice(hash + 1).trim())
    || (params['#'] ? decodeURIComponent(params['#']).trim() : undefined);
  const line = params.line;
  if (line !== undefined && (!/^\d+$/.test(line) || Number(line) < 1 || Number(line) > 0xffffffff)) {
    throw new Error('A line number in a note link must be a positive integer.');
  }

  const path = await resolveWikiLink(encodeURIComponent(file), vault.path, null, true);
  if (!path) throw new Error('The note in this link was not found in the vault.');
  return { vault, path, heading: line ? undefined : heading?.replace(/^#+\s*/, ''), line };
}
