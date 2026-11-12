//! Thin Tauri adapter. All repository behavior lives in noteriv-git.
use crate::{auth, AppState};
use noteriv_git as git;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::State;

fn scoped(state: &AppState, dir: &str) -> Result<(), String> {
    if state.scope.is_allowed(Path::new(dir)) {
        Ok(())
    } else {
        Err("Choose a vault or grant this directory in the file dialog first".into())
    }
}
async fn credentials(id: Option<&str>, dir: &str) -> Result<git::Credentials, String> {
    let Some(id) = id else {
        return Ok(Default::default());
    };
    let vault = crate::store::get_vaults()
        .into_iter()
        .find(|v| v.id == id)
        .ok_or("Unknown vault")?;
    if dunce::canonicalize(&vault.path).map_err(|_| "Vault directory is unavailable")?
        != dunce::canonicalize(dir).map_err(|_| "Vault directory is unavailable")?
    {
        return Err("Credentials belong to another vault".into());
    }
    auth::network_credentials(id).await
}
async fn background<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "Git worker failed".to_owned())?
}
async fn mutate<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    background(move || {
        let _guard = crate::commands_fs::lock_file_mutations();
        f()
    })
    .await
}
#[tauri::command]
pub async fn git_is_installed() -> bool {
    true
}
#[tauri::command]
pub async fn git_is_repo(state: State<'_, AppState>, dir: String) -> Result<bool, String> {
    scoped(&state, &dir)?;
    Ok(git::status(Path::new(&dir))
        .map_err(|e| e.to_string())?
        .is_repo)
}
#[tauri::command]
pub async fn git_init(state: State<'_, AppState>, dir: String) -> Result<bool, String> {
    scoped(&state, &dir)?;
    mutate(move || {
        git::init(Path::new(&dir)).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}
#[derive(Deserialize)]
pub struct SetRemoteInput {
    dir: String,
    url: String,
}
#[tauri::command]
pub async fn git_set_remote(
    state: State<'_, AppState>,
    args: SetRemoteInput,
) -> Result<bool, String> {
    scoped(&state, &args.dir)?;
    let url = args.url.trim();
    if !url.is_empty() {
        git::validate_remote(url).map_err(|e| e.to_string())?;
    }
    let old = git::status(Path::new(&args.dir))
        .map_err(|e| e.to_string())?
        .remote;
    let changed_host = old
        .as_deref()
        .is_some_and(|old| remote_host(old) != remote_host(url));
    let vaults: Vec<_> = crate::store::get_vaults()
        .into_iter()
        .filter(|v| dunce::canonicalize(&v.path).ok() == dunce::canonicalize(&args.dir).ok())
        .collect();
    if changed_host {
        // Bind legacy credentials before changing the URL. A concurrent request
        // cannot send them to the new host, even if removing the entry fails.
        for vault in &vaults {
            if let Some(mut credentials) = auth::get_credentials(&vault.id)? {
                if credentials.origin.is_none() {
                    credentials.origin = old.as_deref().and_then(|r| git::remote_origin(r).ok());
                    auth::save_credentials(&vault.id, &credentials)?;
                }
            }
        }
    }
    git::set_remote(Path::new(&args.dir), url).map_err(|e| e.to_string())?;
    if changed_host {
        for vault in vaults {
            auth::remove_token(&vault.id)?;
        }
    }
    Ok(true)
}
fn remote_host(url: &str) -> String {
    if let Ok(u) = url::Url::parse(url) {
        return format!(
            "{}://{}:{}",
            u.scheme(),
            u.host_str().unwrap_or(""),
            u.port_or_known_default().unwrap_or(22)
        );
    }
    url.split_once('@')
        .map(|(_, r)| format!("ssh://{}:22", r.split(':').next().unwrap_or("")))
        .unwrap_or_default()
}
#[tauri::command]
pub async fn git_status(state: State<'_, AppState>, dir: String) -> Result<git::Status, String> {
    scoped(&state, &dir)?;
    background(move || git::status(Path::new(&dir)).map_err(|e| e.to_string())).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncInput {
    dir: String,
    vault_id: Option<String>,
    message: Option<String>,
}
async fn run(args: GitSyncInput, action: &'static str) -> Result<bool, String> {
    let creds = credentials(args.vault_id.as_deref(), &args.dir).await?;
    mutate(move || {
        let status = git::run(
            Path::new(&args.dir),
            action,
            &creds,
            args.message.as_deref().unwrap_or("Sync notes"),
        )
        .map_err(|e| e.to_string())?;
        if !status.conflicts.is_empty() {
            return Err(format!(
                "Sync paused: {} file(s) have conflicts. Open Settings > Sync to resolve them.",
                status.conflicts.len()
            ));
        }
        Ok(true)
    })
    .await
}
#[tauri::command]
pub async fn git_sync(state: State<'_, AppState>, args: GitSyncInput) -> Result<bool, String> {
    scoped(&state, &args.dir)?;
    run(args, "sync").await
}
#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>, args: GitSyncInput) -> Result<bool, String> {
    scoped(&state, &args.dir)?;
    run(args, "pull").await
}
#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>, args: GitSyncInput) -> Result<bool, String> {
    scoped(&state, &args.dir)?;
    run(args, "fetch").await
}
#[derive(Deserialize)]
pub struct GitLogInput {
    dir: String,
    count: Option<usize>,
}
fn display_dates(mut entries: Vec<git::LogEntry>) -> Vec<git::LogEntry> {
    for entry in &mut entries {
        if let Ok(seconds) = entry.date.parse::<i64>() {
            if let Some(date) = chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0) {
                entry.date = date.to_rfc3339();
            }
        }
    }
    entries
}
#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    args: GitLogInput,
) -> Result<Vec<git::LogEntry>, String> {
    scoped(&state, &args.dir)?;
    background(move || {
        git::history(Path::new(&args.dir), args.count.unwrap_or(20))
            .map(display_dates)
            .map_err(|e| e.to_string())
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneInput {
    url: String,
    dir: String,
    vault_id: Option<String>,
}
#[tauri::command]
pub async fn git_clone(state: State<'_, AppState>, args: GitCloneInput) -> Result<bool, String> {
    scoped(&state, &args.dir)?;
    let creds = match args.vault_id {
        Some(id) => auth::get_credentials(&id)?.unwrap_or_default(),
        None => Default::default(),
    };
    mutate(move || {
        git::clone_repository(&args.url, Path::new(&args.dir), &creds)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileLogInput {
    dir: String,
    file_path: String,
}
fn relative(dir: &str, path: &str) -> Result<String, String> {
    PathBuf::from(path)
        .strip_prefix(dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "File must be inside the vault".into())
}
#[tauri::command]
pub async fn git_file_log(
    state: State<'_, AppState>,
    args: GitFileLogInput,
) -> Result<Vec<git::LogEntry>, String> {
    scoped(&state, &args.dir)?;
    let rel = relative(&args.dir, &args.file_path)?;
    background(move || {
        git::file_history(Path::new(&args.dir), &rel, 500)
            .map(display_dates)
            .map_err(|e| e.to_string())
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowFileInput {
    dir: String,
    file_path: String,
    hash: String,
}
#[tauri::command]
pub async fn git_show_file(
    state: State<'_, AppState>,
    args: GitShowFileInput,
) -> Result<String, String> {
    scoped(&state, &args.dir)?;
    let rel = relative(&args.dir, &args.file_path)?;
    background(move || git::show(Path::new(&args.dir), &args.hash, &rel).map_err(|e| e.to_string()))
        .await
}
#[tauri::command]
pub async fn git_native(
    state: State<'_, AppState>,
    mut request: Value,
    vault_id: Option<String>,
) -> Result<Value, String> {
    let dir = request["dir"]
        .as_str()
        .ok_or("Missing vault path")?
        .to_owned();
    scoped(&state, &dir)?;
    let network = matches!(
        request["action"].as_str(),
        Some("sync" | "pull" | "fetch" | "push")
    );
    request["credentials"] = if network {
        json!(credentials(vault_id.as_deref(), &dir).await?)
    } else {
        json!(git::Credentials::default())
    };
    let read_only = matches!(
        request["action"].as_str(),
        Some("status" | "history" | "show")
    );
    background(move || {
        let _guard = if read_only {
            None
        } else {
            Some(crate::commands_fs::lock_file_mutations())
        };
        let response: Value = serde_json::from_str(&git::bridge::dispatch(&request.to_string()))
            .map_err(|_| "Invalid Git response")?;
        if response["ok"] == true {
            Ok(response["value"].clone())
        } else {
            Err(response["error"].as_str().unwrap_or("Git failed").into())
        }
    })
    .await
}
#[tauri::command]
pub async fn git_save_credentials(
    vault_id: String,
    credentials: git::Credentials,
) -> Result<bool, String> {
    if !crate::store::get_vaults().iter().any(|v| v.id == vault_id) {
        return Err("Unknown vault".into());
    }
    auth::save_credentials(&vault_id, &credentials)?;
    Ok(true)
}
