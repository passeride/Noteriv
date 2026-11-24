// Thin GitHub REST client used by the sync UI (token check, repo picker, repo
// creation, branch list). Only ever called server-side with a token the user
// supplied or one already stored encrypted on a SyncConnection — the token is
// never returned to the browser.

const API = "https://api.github.com";

export class GithubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GithubApiError";
  }
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface GithubRepo {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  description: string | null;
  updatedAt: string;
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "noteriv-web",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new GithubApiError(0, err instanceof Error ? err.message : "network error");
  }
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new GithubApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export async function githubUser(token: string): Promise<GithubUser> {
  const u = await gh<{ login: string; name: string | null; avatar_url: string }>(token, "/user");
  return { login: u.login, name: u.name, avatarUrl: u.avatar_url };
}

interface RawRepo {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
  description: string | null;
  updated_at: string;
}

function mapRepo(r: RawRepo): GithubRepo {
  return {
    fullName: r.full_name,
    name: r.name,
    private: r.private,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    description: r.description,
    updatedAt: r.updated_at,
  };
}

export async function githubListRepos(token: string, page = 1): Promise<GithubRepo[]> {
  const p = Math.max(1, Math.min(page, 20));
  const repos = await gh<RawRepo[]>(
    token,
    `/user/repos?per_page=50&page=${p}&sort=updated&affiliation=owner,collaborator,organization_member`
  );
  return repos.map(mapRepo);
}

export async function githubCreateRepo(
  token: string,
  name: string,
  isPrivate: boolean,
  description?: string
): Promise<GithubRepo> {
  const r = await gh<RawRepo>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, private: isPrivate, description: description ?? "Noteriv vault", auto_init: false }),
  });
  return mapRepo(r);
}

export const GITHUB_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function githubListBranches(token: string, fullName: string): Promise<string[]> {
  if (!GITHUB_FULL_NAME_RE.test(fullName)) throw new GithubApiError(400, "invalid repository name");
  const branches = await gh<Array<{ name: string }>>(token, `/repos/${fullName}/branches?per_page=100`);
  return branches.map((b) => b.name);
}

/** True when `remoteUrl` points at github.com (https or ssh/scp form). */
export function isGithubRemote(remoteUrl: string | null | undefined): boolean {
  if (!remoteUrl) return false;
  return /^(https?:\/\/|ssh:\/\/)?(git@)?(www\.)?github\.com[/:]/i.test(remoteUrl);
}
