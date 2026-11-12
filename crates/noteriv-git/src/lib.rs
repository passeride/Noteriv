//! One Git implementation for Tauri and the local Expo module. No forge REST API.
//! Conflicts stay in the Git index until the user explicitly resolves them.
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use git2::{
    build::CheckoutBuilder, CertificateCheckStatus, Cred, Error, FetchOptions, IndexAddOption,
    PushOptions, RemoteCallbacks, Repository, RepositoryState, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, Error>;
fn fail(message: &str) -> Error {
    Error::from_str(message)
}
fn io(e: std::io::Error) -> Error {
    fail(&e.to_string())
}

#[derive(Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token: String,
    pub ssh_private_key: Option<String>,
    pub ssh_passphrase: Option<String>,
    /// Base64 SHA256 host key fingerprint, independently verified by the user.
    pub host_key_sha256: Option<String>,
    pub oauth: Option<serde_json::Value>,
    pub origin: Option<String>,
}
#[derive(Default, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub last_success: Option<u64>,
    pub last_error: Option<String>,
}
#[derive(Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub changes: usize,
    pub changed_files: Vec<String>,
    pub conflicts: Vec<String>,
    pub ahead: usize,
    pub behind: usize,
    pub merge_pending: bool,
    pub in_progress: bool,
    pub pulled: usize,
    pub pushed: usize,
    pub sync: SyncState,
}
#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

/// Reject credentials embedded in URLs. Credentials are only passed in callbacks.
pub fn validate_remote(remote: &str) -> Result<()> {
    if remote.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(fail("Invalid remote URL"));
    }
    if let Some(rest) = remote.strip_prefix("https://") {
        let authority = rest.split('/').next().unwrap_or("");
        if authority.is_empty() || authority.contains('@') {
            return Err(fail(
                "Use a credential field, not credentials in the remote URL",
            ));
        }
        if !rest.contains('/') {
            return Err(fail("Remote repository path is required"));
        }
        return Ok(());
    }
    let rest = remote.strip_prefix("ssh://").unwrap_or(remote);
    if let Some((user, host_path)) = rest.split_once('@') {
        if !user.is_empty()
            && !user.contains(['/', ':'])
            && !host_path.is_empty()
            && (host_path.contains(':')
                || (remote.starts_with("ssh://") && host_path.contains('/')))
        {
            return Ok(());
        }
    }
    Err(fail(
        "Remote must use HTTPS or SSH (user@host:path or ssh://user@host/path)",
    ))
}
pub fn remote_origin(remote: &str) -> Result<String> {
    validate_remote(remote)?;
    if let Ok(url) = url::Url::parse(remote) {
        return Ok(format!(
            "{}://{}:{}",
            url.scheme(),
            url.host_str().unwrap_or("").to_lowercase(),
            url.port_or_known_default().unwrap_or(22)
        ));
    }
    let (_, rest) = remote
        .split_once('@')
        .ok_or_else(|| fail("Invalid remote"))?;
    Ok(format!(
        "ssh://{}:22",
        rest.split(':').next().unwrap_or("").to_lowercase()
    ))
}
fn check_credentials(remote: &str, creds: &Credentials) -> Result<()> {
    let origin = remote_origin(remote)?;
    if creds
        .origin
        .as_ref()
        .is_some_and(|expected| expected != &origin)
    {
        return Err(fail(
            "Credentials belong to another server. Save credentials for this remote first.",
        ));
    }
    if creds.oauth.is_some() && origin != "https://github.com:443" {
        return Err(fail(
            "GitHub App tokens can only authenticate HTTPS remotes on github.com",
        ));
    }
    Ok(())
}
fn callbacks(creds: &Credentials) -> RemoteCallbacks<'_> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |url, username, allowed| {
        check_credentials(url, creds)?;
        let user = if creds.username.is_empty() {
            username.unwrap_or("git")
        } else {
            &creds.username
        };
        if allowed.is_ssh_key() {
            return match &creds.ssh_private_key {
                Some(key) => {
                    Cred::ssh_key_from_memory(user, None, key, creds.ssh_passphrase.as_deref())
                }
                None => Cred::ssh_key_from_agent(user),
            };
        }
        if allowed.is_user_pass_plaintext() && !creds.token.is_empty() {
            return Cred::userpass_plaintext(
                if creds.username.is_empty() {
                    "oauth2"
                } else {
                    user
                },
                &creds.token,
            );
        }
        if allowed.is_username() {
            return Cred::username(user);
        }
        Err(fail("Credentials are required for this remote"))
    });
    cb.certificate_check(move |cert, _host| {
        if let Some(key) = cert.as_hostkey() {
            let hash = key.hash_sha256().ok_or_else(|| fail("SSH server did not supply a SHA256 host key"))?;
            let actual = STANDARD.encode(hash).trim_end_matches('=').to_owned();
            let expected = creds.host_key_sha256.as_deref().unwrap_or("").trim().trim_start_matches("SHA256:").trim_end_matches('=');
            if actual != expected {
                return Err(fail(&format!("SSH host key is not trusted. Verify SHA256:{actual} independently, then save the fingerprint.")));
            }
            return Ok(CertificateCheckStatus::CertificateOk);
        }
        // Never override TLS validation.
        Ok(CertificateCheckStatus::CertificatePassthrough)
    });
    cb
}
fn lock(repo: &Repository) -> Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(repo.path().join("noteriv-sync.lock"))
        .map_err(io)?;
    file.try_lock_exclusive()
        .map_err(|_| fail("Another Git operation is running for this vault"))?;
    Ok(file)
}
fn state_path(repo: &Repository) -> PathBuf {
    repo.path().join("noteriv-sync.json")
}
fn read_state(repo: &Repository) -> SyncState {
    fs::read(state_path(repo))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn record(repo: &Repository, error: Option<&Error>, success: bool) -> Result<()> {
    let mut state = read_state(repo);
    state.last_error = error.map(|_| "Git operation failed. Check connectivity, credentials and repository state, then retry.".into());
    if success {
        state.last_success = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
    }
    let bytes = serde_json::to_vec(&state).map_err(|_| fail("Cannot encode sync state"))?;
    let temp = repo.path().join("noteriv-sync.json.tmp");
    fs::write(&temp, bytes).map_err(io)?;
    // Windows rename cannot replace an existing file.
    if state_path(repo).exists() {
        fs::remove_file(state_path(repo)).map_err(io)?;
    }
    fs::rename(temp, state_path(repo)).map_err(io)
}
fn clean_url(value: &str) -> Option<String> {
    let mut url = url::Url::parse(value).ok()?;
    if !["http", "https"].contains(&url.scheme())
        || (url.username().is_empty() && url.password().is_none())
    {
        return None;
    }
    url.set_password(None).ok()?;
    url.set_username("").ok()?;
    Some(url.to_string())
}
fn scrub_legacy_urls(repo: &Repository) -> Result<()> {
    let mut config = repo.config()?.open_level(git2::ConfigLevel::Local)?;
    let mut changes = Vec::new();
    {
        let mut entries = config.entries(None)?;
        while let Some(entry) = entries.next() {
            let entry = entry?;
            let (Some(name), Some(value)) = (entry.name(), entry.value()) else {
                continue;
            };
            if name.starts_with("remote.") && (name.ends_with(".url") || name.ends_with(".pushurl"))
            {
                if let Some(clean) = clean_url(value) {
                    changes.push((name.to_owned(), clean));
                }
            } else if name.starts_with("branch.")
                && name.ends_with(".remote")
                && clean_url(value).is_some()
            {
                changes.push((name.to_owned(), "origin".into()));
            }
        }
    }
    for (key, value) in changes {
        config.set_str(&key, &value)?;
    }
    Ok(())
}
fn exclude_metadata(repo: &Repository) -> Result<()> {
    // Local exclusions also apply to repositories created by older versions.
    let directory = repo.path().join("info");
    fs::create_dir_all(&directory).map_err(io)?;
    let excludes = directory.join("exclude");
    let mut text = match fs::read_to_string(&excludes) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(io(e)),
    };
    let previous = text.len();
    for pattern in [".noteriv/", ".trash/"] {
        if !text.lines().any(|line| line == pattern) {
            text.push_str(&format!("\n{pattern}\n"));
        }
    }
    if text.len() != previous {
        fs::write(excludes, text).map_err(io)?;
    }
    Ok(())
}
pub fn init(path: &Path) -> Result<()> {
    let repo = Repository::init(path)?;
    let _lock = lock(&repo)?;
    repo.config()?.set_bool("core.symlinks", false)?;
    scrub_legacy_urls(&repo)?;
    exclude_metadata(&repo)
}
pub fn clone_repository(remote: &str, path: &Path, creds: &Credentials) -> Result<()> {
    check_credentials(remote, creds)?;
    if path.exists() && fs::read_dir(path).map_err(io)?.next().is_some() {
        return Err(fail("Clone destination must be empty"));
    }
    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(callbacks(creds));
    fetch.follow_redirects(git2::RemoteRedirect::None);
    git2::build::RepoBuilder::new()
        .fetch_options(fetch)
        .clone(remote, path)?;
    init(path)
}
pub fn set_remote(path: &Path, remote: &str) -> Result<()> {
    let repo = Repository::open(path)?;
    let _lock = lock(&repo)?;
    if remote.is_empty() {
        if repo.find_remote("origin").is_ok() {
            repo.remote_delete("origin")?;
        }
        return Ok(());
    }
    validate_remote(remote)?;
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", remote)?;
    } else {
        repo.remote("origin", remote)?;
    }
    Ok(())
}
pub fn status(path: &Path) -> Result<Status> {
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(Status::default()),
        Err(e) => return Err(e),
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let changed_files: Vec<_> = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter_map(|s| s.path().map(str::to_owned))
        .collect();
    let mut conflicts = Vec::new();
    for conflict in repo.index()?.conflicts()? {
        let c = conflict?;
        if let Some(e) = c.our.or(c.their).or(c.ancestor) {
            conflicts.push(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    let branch = repo.head().ok().and_then(|h| {
        if h.is_branch() {
            h.shorthand().map(str::to_owned)
        } else {
            None
        }
    });
    let remote = repo.find_remote("origin").ok().and_then(|r| {
        r.url()
            .map(|u| clean_url(u).unwrap_or_else(|| u.to_owned()))
    });
    let (ahead, behind) = branch
        .as_ref()
        .and_then(|b| {
            let local = repo.head().ok()?.target()?;
            let remote = repo
                .find_reference(&format!("refs/remotes/origin/{b}"))
                .ok()?
                .target()?;
            repo.graph_ahead_behind(local, remote).ok()
        })
        .unwrap_or_default();
    let operation_lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(repo.path().join("noteriv-sync.lock"))
        .map_err(io)?;
    let in_progress = operation_lock.try_lock_exclusive().is_err();
    Ok(Status {
        in_progress,
        pulled: 0,
        pushed: 0,
        is_repo: true,
        changes: changed_files.len(),
        changed_files,
        conflicts,
        branch,
        remote,
        ahead,
        behind,
        merge_pending: repo.state() == RepositoryState::Merge,
        sync: read_state(&repo),
    })
}
fn signature(repo: &Repository) -> Result<Signature<'static>> {
    // No provider identity is silently invented if Git has no author configured.
    repo.signature()
        .map_err(|_| fail("Set your Git author name and email before committing"))
}
pub fn set_identity(path: &Path, name: &str, email: &str) -> Result<()> {
    if name.trim().is_empty()
        || email.trim().is_empty()
        || name.contains(['\n', '\r'])
        || email.contains(['\n', '\r'])
    {
        return Err(fail("Git author name and email are required"));
    }
    let repo = Repository::open(path)?;
    let _lock = lock(&repo)?;
    repo.config()?.set_str("user.name", name.trim())?;
    repo.config()?.set_str("user.email", email.trim())
}
fn commit_all(repo: &Repository, message: &str) -> Result<()> {
    if repo.state() != RepositoryState::Clean || repo.index()?.has_conflicts() {
        return Err(fail("Resolve the existing merge/rebase before syncing"));
    }
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let parent = match repo.head() {
        Ok(head) => {
            if !head.is_branch() {
                return Err(fail("Attach HEAD to a branch before syncing"));
            }
            Some(head.peel_to_commit()?)
        }
        Err(e)
            if e.code() == git2::ErrorCode::UnbornBranch
                || e.code() == git2::ErrorCode::NotFound =>
        {
            None
        }
        Err(e) => return Err(e),
    };
    if parent.as_ref().map(|p| p.tree_id()) == Some(tree_id)
        || (parent.is_none() && tree.is_empty())
    {
        return Ok(());
    }
    let sig = signature(repo)?;
    let parents: Vec<_> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(())
}
fn branch_name(repo: &Repository) -> Result<String> {
    if let Ok(h) = repo.head() {
        if h.is_branch() {
            return h
                .shorthand()
                .map(str::to_owned)
                .ok_or_else(|| fail("Invalid branch"));
        }
        return Err(fail("Attach HEAD to a branch before syncing"));
    }
    let head = repo.find_reference("HEAD")?;
    head.symbolic_target()
        .and_then(|s| s.strip_prefix("refs/heads/"))
        .map(str::to_owned)
        .ok_or_else(|| fail("No branch selected"))
}
fn fetch_repo(repo: &Repository, creds: &Credentials) -> Result<()> {
    let mut remote = repo.find_remote("origin")?;
    check_credentials(remote.url().unwrap_or(""), creds)?;
    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks(creds));
    options.follow_redirects(git2::RemoteRedirect::None);
    remote.fetch(
        &["+refs/heads/*:refs/remotes/origin/*"],
        Some(&mut options),
        None,
    )
}
fn merge_remote(repo: &Repository) -> Result<()> {
    let branch = branch_name(repo)?;
    let remote = match repo.find_reference(&format!("refs/remotes/origin/{branch}")) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let target = remote.peel_to_commit()?;
    let annotated = repo.find_annotated_commit(target.id())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;
    if analysis.is_up_to_date() {
        return Ok(());
    }
    if analysis.is_fast_forward() || analysis.is_unborn() {
        // SAFE checkout refuses to overwrite edits made while a fetch ran.
        repo.checkout_tree(target.as_object(), Some(CheckoutBuilder::new().safe()))?;
        repo.reference(
            &format!("refs/heads/{branch}"),
            target.id(),
            true,
            "Noteriv fast-forward",
        )?;
        repo.set_head(&format!("refs/heads/{branch}"))?;
        return Ok(());
    }
    let mut checkout = CheckoutBuilder::new();
    checkout.safe().allow_conflicts(true);
    repo.merge(&[&annotated], None, Some(&mut checkout))?;
    if repo.index()?.has_conflicts() {
        return Ok(());
    }
    finish_merge(repo)
}
fn finish_merge(repo: &Repository) -> Result<()> {
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(fail("Unresolved conflicts remain"));
    }
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let ours = repo.head()?.peel_to_commit()?;
    let theirs = repo.revparse_single("MERGE_HEAD")?.peel_to_commit()?;
    let sig = signature(repo)?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "Merge remote changes",
        &tree,
        &[&ours, &theirs],
    )?;
    repo.cleanup_state()
}
fn push_repo(repo: &Repository, creds: &Credentials) -> Result<()> {
    if repo.index()?.has_conflicts() || repo.state() != RepositoryState::Clean {
        return Err(fail("Resolve the merge before pushing"));
    }
    let branch = branch_name(repo)?;
    let mut remote = repo.find_remote("origin")?;
    check_credentials(
        remote.pushurl().or_else(|| remote.url()).unwrap_or(""),
        creds,
    )?;
    let mut cb = callbacks(creds);
    // libgit2 may report transport success even when the server rejects the ref.
    cb.push_update_reference(|_, rejection| match rejection {
        Some(_) => Err(fail(
            "Remote rejected the push; fetch and resolve changes, or check repository permissions",
        )),
        None => Ok(()),
    });
    let mut options = PushOptions::new();
    options.remote_callbacks(cb);
    options.follow_redirects(git2::RemoteRedirect::None);
    remote.push(
        &[&format!("refs/heads/{branch}:refs/heads/{branch}")],
        Some(&mut options),
    )
}
pub fn run(path: &Path, action: &str, creds: &Credentials, message: &str) -> Result<Status> {
    let repo = Repository::open(path)?;
    let _lock = lock(&repo)?;
    scrub_legacy_urls(&repo)?;
    exclude_metadata(&repo)?;
    let mut pulled = 0;
    let mut pushed = 0;
    let result = (|| {
        match action {
            "commit" => commit_all(&repo, message)?,
            "fetch" => fetch_repo(&repo, creds)?,
            "pull" | "sync" => {
                commit_all(&repo, message)?;
                if repo.find_remote("origin").is_ok() {
                    fetch_repo(&repo, creds)?;
                    let local_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
                    let branch = branch_name(&repo)?;
                    let remote_tree = repo
                        .find_reference(&format!("refs/remotes/origin/{branch}"))
                        .ok()
                        .and_then(|r| r.peel_to_tree().ok());
                    merge_remote(&repo)?;
                    let after_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
                    pulled = repo
                        .diff_tree_to_tree(local_tree.as_ref(), after_tree.as_ref(), None)?
                        .deltas()
                        .len();
                    pushed = repo
                        .diff_tree_to_tree(remote_tree.as_ref(), after_tree.as_ref(), None)?
                        .deltas()
                        .len();
                    if action == "sync"
                        && !repo.index()?.has_conflicts()
                        && repo.state() == RepositoryState::Clean
                    {
                        push_repo(&repo, creds)?;
                    }
                }
            }
            "finishMerge" => {
                if repo.state() != RepositoryState::Merge {
                    return Err(fail("No merge is pending"));
                }
                finish_merge(&repo)?;
            }
            "push" => push_repo(&repo, creds)?,
            _ => return Err(fail("Unknown Git operation")),
        }
        Ok(())
    })();
    record(
        &repo,
        result.as_ref().err(),
        result.is_ok()
            && !repo.index()?.has_conflicts()
            && action == "sync"
            && repo.find_remote("origin").is_ok(),
    )?;
    // Don't persist libgit2 errors: even a server response can contain secrets.
    result.map_err(|error| {
        let mut message = error.message().to_owned();
        for secret in [
            Some(creds.token.as_str()),
            creds.ssh_private_key.as_deref(),
            creds.ssh_passphrase.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !secret.is_empty() {
                message = message.replace(secret, "[redacted]");
            }
        }
        fail(&message.chars().take(1000).collect::<String>())
    })?;
    let mut result = status(path)?;
    result.pulled = pulled;
    result.pushed = if action == "sync" && result.conflicts.is_empty() {
        pushed
    } else {
        0
    };
    Ok(result)
}
fn safe_path(repo: &Repository, rel: &str) -> Result<PathBuf> {
    let mut path = repo
        .workdir()
        .ok_or_else(|| fail("A working directory is required"))?
        .to_owned();
    if rel.is_empty() {
        return Err(fail("Empty file path"));
    }
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p)
                if p.to_string_lossy().to_lowercase() != ".git"
                    && !p.to_string_lossy().contains(':')
                    && !p.to_string_lossy().ends_with(['.', ' ']) =>
            {
                path.push(p)
            }
            _ => return Err(fail("File must be inside the vault")),
        }
        if fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(fail("Symlinks cannot be resolved as note conflicts"));
        }
    }
    Ok(path)
}
pub fn resolve(path: &Path, rel: &str, side: &str) -> Result<Status> {
    let repo = Repository::open(path)?;
    let _lock = lock(&repo)?;
    exclude_metadata(&repo)?;
    let dest = safe_path(&repo, rel)?;
    let mut index = repo.index()?;
    let conflict = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .find(|c| {
            [&c.our, &c.their, &c.ancestor]
                .iter()
                .any(|e| e.as_ref().map(|e| e.path.as_slice()) == Some(rel.as_bytes()))
        })
        .ok_or_else(|| fail("No conflict at this path"))?;
    let selected = match side {
        "ours" => conflict.our,
        "theirs" => conflict.their,
        _ => return Err(fail("Choose ours or theirs")),
    };
    // Edits made after the merge started may not be in either conflict stage.
    // Keep the working bytes before any explicit replacement/deletion.
    let working_bytes = match fs::read(&dest) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(io(e)),
    };
    if let Some(bytes) = working_bytes {
        let chosen = selected
            .as_ref()
            .and_then(|e| repo.find_blob(e.id).ok())
            .map(|b| b.content().to_vec());
        if chosen.as_deref() != Some(bytes.as_slice()) {
            let workdir = repo
                .workdir()
                .ok_or_else(|| fail("A working directory is required"))?;
            let recovery = workdir.join(".noteriv").join("conflict-recovery");
            // Do not follow metadata-directory symlinks supplied by a remote.
            for directory in [workdir.join(".noteriv"), recovery.clone()] {
                if fs::symlink_metadata(&directory)
                    .map(|m| m.file_type().is_symlink())
                    .unwrap_or(false)
                {
                    return Err(fail("Recovery directory must not be a symlink"));
                }
            }
            fs::create_dir_all(&recovery).map_err(io)?;
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let name = dest
                .file_name()
                .ok_or_else(|| fail("Invalid conflict filename"))?
                .to_string_lossy();
            let recovery_file = recovery.join(format!("{stamp}-{name}"));
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(recovery_file)
                .map_err(io)?;
            std::io::Write::write_all(&mut file, &bytes).map_err(io)?;
        }
    }
    if let Some(entry) = selected {
        if entry.mode != 0o100644 && entry.mode != 0o100755 {
            return Err(fail("Only regular files can be resolved here"));
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        fs::write(&dest, repo.find_blob(entry.id)?.content()).map_err(io)?;
        index.add_path(Path::new(rel))?;
    } else {
        if dest.exists() {
            fs::remove_file(dest).map_err(io)?;
        }
        index.remove_path(Path::new(rel))?;
    }
    index.write()?;
    if !index.has_conflicts() && repo.state() == RepositoryState::Merge {
        finish_merge(&repo)?;
    }
    status(path)
}
pub fn history(path: &Path, count: usize) -> Result<Vec<LogEntry>> {
    let repo = Repository::open(path)?;
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(git2::Sort::TIME)?;
    walk.take(count.min(500))
        .map(|id| {
            let c = repo.find_commit(id?)?;
            let author = c.author().name().unwrap_or("").to_owned();
            Ok(LogEntry {
                hash: c.id().to_string(),
                author,
                date: c.time().seconds().to_string(),
                message: c.summary().unwrap_or("").into(),
            })
        })
        .collect()
}
/// Follow a note through renames and include only commits which changed it.
pub fn file_history(path: &Path, rel: &str, count: usize) -> Result<Vec<LogEntry>> {
    let repo = Repository::open(path)?;
    safe_path(&repo, rel)?;
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL)?;
    let mut current = PathBuf::from(rel);
    let mut out = Vec::new();
    for id in walk {
        let commit = repo.find_commit(id?)?;
        let tree = commit.tree()?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };
        let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
        diff.find_similar(None)?;
        let mut changed = false;
        for delta in diff.deltas() {
            if delta.new_file().path() == Some(current.as_path())
                || delta.old_file().path() == Some(current.as_path())
            {
                changed = true;
                if delta.status() == git2::Delta::Renamed
                    && delta.new_file().path() == Some(current.as_path())
                {
                    if let Some(old) = delta.old_file().path() {
                        current = old.to_owned();
                    }
                }
                break;
            }
        }
        if changed {
            let author = commit.author().name().unwrap_or("").to_owned();
            out.push(LogEntry {
                hash: commit.id().to_string(),
                author,
                date: commit.time().seconds().to_string(),
                message: commit.summary().unwrap_or("").into(),
            });
            if out.len() >= count.min(500) {
                break;
            }
        }
    }
    Ok(out)
}

pub fn show(path: &Path, revision: &str, rel: &str) -> Result<String> {
    let repo = Repository::open(path)?;
    safe_path(&repo, rel)?;
    let commit = repo.find_commit(git2::Oid::from_str(revision)?)?;
    let tree = commit.tree()?;
    let entry = tree.get_path(Path::new(rel))?;
    if entry.kind() != Some(git2::ObjectType::Blob) {
        return Err(fail("Not a file"));
    }
    let bytes = repo.find_blob(entry.id())?.content().to_vec();
    String::from_utf8(bytes).map_err(|_| fail("Not a UTF-8 note"))
}

pub mod bridge;

#[cfg(test)]
mod merge_tests {
    use super::*;
    fn vault(text: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path()).unwrap();
        set_identity(dir.path(), "Test", "test@example.com").unwrap();
        fs::write(dir.path().join("note.md"), text).unwrap();
        let repo = Repository::open(dir.path()).unwrap();
        commit_all(&repo, "initial").unwrap();
        dir
    }
    fn track(repo: &Repository, other: &Repository) {
        let oid = other.head().unwrap().target().unwrap();
        // Transfer objects without enabling file:// in production transports.
        let name = other.path().to_str().unwrap();
        let mut remote = repo.remote_anonymous(name).unwrap();
        remote
            .fetch(&["+refs/heads/*:refs/remotes/origin/*"], None, None)
            .unwrap();
        let branch = branch_name(repo).unwrap();
        repo.reference(&format!("refs/remotes/origin/{branch}"), oid, true, "test")
            .unwrap();
    }
    #[test]
    fn existing_api_vault_merges_unrelated_history_without_losing_either_side() {
        let local = vault("local\n");
        let remote = vault("remote\n");
        let repo = Repository::open(local.path()).unwrap();
        let other = Repository::open(remote.path()).unwrap();
        track(&repo, &other);
        merge_remote(&repo).unwrap();
        assert!(repo.index().unwrap().has_conflicts());
        let conflict = repo
            .index()
            .unwrap()
            .conflicts()
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(
            repo.find_blob(conflict.our.unwrap().id).unwrap().content(),
            b"local\n"
        );
        assert_eq!(
            repo.find_blob(conflict.their.unwrap().id)
                .unwrap()
                .content(),
            b"remote\n"
        );
    }
    #[test]
    fn fast_forward_refuses_concurrent_local_edits() {
        let local = vault("base\n");
        let remote_dir = tempfile::tempdir().unwrap();
        let other = Repository::clone(local.path().to_str().unwrap(), remote_dir.path()).unwrap();
        set_identity(remote_dir.path(), "Other", "other@example.com").unwrap();
        fs::write(remote_dir.path().join("note.md"), "remote\n").unwrap();
        commit_all(&other, "remote").unwrap();
        let repo = Repository::open(local.path()).unwrap();
        track(&repo, &other);
        fs::write(local.path().join("note.md"), "typed during fetch\n").unwrap();
        assert!(merge_remote(&repo).is_err());
        assert_eq!(
            fs::read_to_string(local.path().join("note.md")).unwrap(),
            "typed during fetch\n"
        );
    }
    #[test]
    fn delete_edit_conflict_can_keep_the_deleted_side() {
        let local = vault("base\n");
        let remote_dir = tempfile::tempdir().unwrap();
        let other = Repository::clone(local.path().to_str().unwrap(), remote_dir.path()).unwrap();
        set_identity(remote_dir.path(), "Other", "other@example.com").unwrap();
        fs::write(remote_dir.path().join("note.md"), "remote edit\n").unwrap();
        commit_all(&other, "edit").unwrap();
        let repo = Repository::open(local.path()).unwrap();
        fs::remove_file(local.path().join("note.md")).unwrap();
        commit_all(&repo, "delete").unwrap();
        track(&repo, &other);
        merge_remote(&repo).unwrap();
        assert!(repo.index().unwrap().has_conflicts());
        resolve(local.path(), "note.md", "ours").unwrap();
        assert!(!local.path().join("note.md").exists());
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .parent_count(),
            2
        );
    }
    #[test]
    fn a_second_operation_observes_the_repository_lock() {
        let dir = vault("base\n");
        let repo = Repository::open(dir.path()).unwrap();
        let _guard = lock(&repo).unwrap();
        assert!(status(dir.path()).unwrap().in_progress);
        assert!(run(dir.path(), "commit", &Credentials::default(), "second").is_err());
    }
    #[test]
    fn credentials_are_bound_to_origin_and_oauth_to_github() {
        let creds = Credentials {
            token: "secret".into(),
            origin: Some("https://git.example:443".into()),
            ..Default::default()
        };
        assert!(check_credentials("https://other.example/repo", &creds).is_err());
        check_credentials("https://git.example/repo", &creds).unwrap();
        let oauth = Credentials {
            oauth: Some(serde_json::json!({})),
            ..Default::default()
        };
        assert!(check_credentials("https://other.example/repo", &oauth).is_err());
    }
}
