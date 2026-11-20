// Tokens and SSH keys live exclusively in the operating-system credential store.
use crate::paths;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::HashMap, fs, sync::Mutex};
use tauri_plugin_opener::OpenerExt;
pub type GitCredentials = noteriv_git::Credentials;
static MIGRATION: Mutex<()> = Mutex::new(());
fn entry(vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.noteriv.git", vault_id)
        .map_err(|_| "Cannot access the OS credential store".into())
}
fn storage_error() -> String {
    "OS credential store is locked or unavailable. Unlock it and retry; credentials were not saved to disk.".into()
}
fn legacy() -> Result<HashMap<String, String>, String> {
    match fs::read_to_string(paths::token_file()) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|_| "Legacy credential file is unreadable; enter credentials again".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(_) => Err("Cannot read legacy credential file".into()),
    }
}
fn remove_legacy(id: &str) -> Result<(), String> {
    let mut map = legacy()?;
    if map.remove(id).is_some() {
        if map.is_empty() {
            fs::remove_file(paths::token_file()).map_err(|_| "Cannot remove legacy credentials")?;
        } else {
            fs::write(
                paths::token_file(),
                serde_json::to_vec(&map).map_err(|_| "Cannot encode credentials")?,
            )
            .map_err(|_| "Cannot update legacy credential file")?;
        }
    }
    Ok(())
}
pub fn save_credentials(id: &str, credentials: &GitCredentials) -> Result<(), String> {
    let _guard = MIGRATION.lock().map_err(|_| storage_error())?;
    let mut credentials = credentials.clone();
    if credentials.origin.is_none() {
        let vault = crate::store::get_vaults().into_iter().find(|v| v.id == id);
        credentials.origin = vault
            .and_then(|v| v.git_remote)
            .and_then(|r| noteriv_git::remote_origin(&r).ok());
        if credentials.oauth.is_some() {
            credentials.origin = Some("https://github.com:443".into());
        }
    }
    let value = serde_json::to_string(&credentials).map_err(|_| storage_error())?;
    let entry = entry(id)?;
    entry.set_password(&value).map_err(|_| storage_error())?;
    if entry.get_password().map_err(|_| storage_error())? != value {
        return Err(storage_error());
    }
    remove_legacy(id)
}
pub fn get_credentials(id: &str) -> Result<Option<GitCredentials>, String> {
    let _guard = MIGRATION.lock().map_err(|_| storage_error())?;
    let entry = entry(id)?;
    match entry.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "Stored credentials are unreadable".into()),
        Err(keyring::Error::NoEntry) => {
            let Some(raw) = legacy()?.remove(id) else {
                return Ok(None);
            };
            let decoded = B64
                .decode(raw)
                .map_err(|_| "Enter your credentials again")?;
            let text = String::from_utf8(decoded).map_err(|_| "Enter your credentials again")?;
            let credentials = if let Ok(v) = serde_json::from_str::<Value>(&text) {
                GitCredentials {
                    username: v["u"].as_str().unwrap_or("").into(),
                    token: v["t"].as_str().unwrap_or("").into(),
                    ..Default::default()
                }
            } else {
                GitCredentials {
                    token: text,
                    ..Default::default()
                }
            };
            let value = serde_json::to_string(&credentials).map_err(|_| storage_error())?;
            entry.set_password(&value).map_err(|_| storage_error())?;
            if entry.get_password().map_err(|_| storage_error())? != value {
                return Err(storage_error());
            }
            remove_legacy(id)?;
            Ok(Some(credentials))
        }
        Err(_) => Err(storage_error()),
    }
}
pub fn get_token(id: &str) -> Result<Option<String>, String> {
    Ok(get_credentials(id)?
        .map(|c| c.token)
        .filter(|t| !t.is_empty()))
}
pub fn remove_token(id: &str) -> Result<bool, String> {
    let _guard = MIGRATION.lock().map_err(|_| storage_error())?;
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err(storage_error()),
    }
    remove_legacy(id)?;
    Ok(true)
}
// ============================================================
// IPC commands
// ============================================================

#[derive(Debug, Deserialize)]
pub struct SaveTokenInput {
    #[serde(rename = "vaultId")]
    pub vault_id: String,
    pub token: String,
    /// Auth username (optional). Defaults to "oauth2" when omitted/blank.
    #[serde(default)]
    pub username: Option<String>,
}

#[tauri::command]
pub async fn auth_save_token(args: SaveTokenInput) -> Result<bool, String> {
    save_credentials(
        &args.vault_id,
        &GitCredentials {
            username: args.username.unwrap_or_default(),
            token: args.token,
            ..Default::default()
        },
    )?;
    Ok(true)
}

#[tauri::command]
pub async fn auth_has_token(vault_id: String) -> Result<bool, String> {
    Ok(get_credentials(&vault_id)?.is_some())
}

#[tauri::command]
pub async fn auth_remove_token(vault_id: String) -> Result<bool, String> {
    remove_token(&vault_id)
}

#[derive(Debug, Serialize)]
pub struct GitHubUser {
    pub valid: bool,
    pub username: Option<String>,
    pub name: Option<String>,
    pub avatar: Option<String>,
    pub error: Option<String>,
}

async fn gh_request(
    method: &str,
    url_path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("https://api.github.com{}", url_path);
    let client = reqwest::Client::builder()
        .user_agent("Noteriv")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("unsupported method {method}")),
    };
    req = req.header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    if let Some(b) = body {
        req = req.json(&b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.is_client_error() || status.is_server_error() {
        let msg = serde_json::from_str::<Map<String, Value>>(&text)
            .ok()
            .and_then(|m| m.get("message").and_then(|v| v.as_str().map(String::from)))
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(msg);
    }

    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn auth_validate_token(token: String) -> GitHubUser {
    match gh_request("GET", "/user", Some(&token), None).await {
        Ok(v) => GitHubUser {
            valid: true,
            username: v.get("login").and_then(|s| s.as_str()).map(String::from),
            name: v
                .get("name")
                .and_then(|s| s.as_str())
                .or_else(|| v.get("login").and_then(|s| s.as_str()))
                .map(String::from),
            avatar: v
                .get("avatar_url")
                .and_then(|s| s.as_str())
                .map(String::from),
            error: None,
        },
        Err(e) => GitHubUser {
            valid: false,
            username: None,
            name: None,
            avatar: None,
            error: Some(e),
        },
    }
}

#[derive(Debug, Deserialize)]
pub struct ListReposInput {
    pub token: String,
    #[serde(default)]
    pub page: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct GitHubRepo {
    pub name: String,
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub private: bool,
    #[serde(rename = "cloneUrl")]
    pub clone_url: String,
    #[serde(rename = "sshUrl")]
    pub ssh_url: String,
    pub description: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
}

#[tauri::command]
pub async fn auth_list_repos(args: ListReposInput) -> Result<Vec<GitHubRepo>, String> {
    let page = args.page.unwrap_or(1);
    let path =
        format!("/user/repos?sort=updated&per_page=30&page={page}&affiliation=owner,collaborator");
    let v = gh_request("GET", &path, Some(&args.token), None).await?;
    let arr = v.as_array().cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .map(|r| GitHubRepo {
            name: str_field(&r, "name"),
            full_name: str_field(&r, "full_name"),
            private: r.get("private").and_then(|b| b.as_bool()).unwrap_or(false),
            clone_url: str_field(&r, "clone_url"),
            ssh_url: str_field(&r, "ssh_url"),
            description: r
                .get("description")
                .and_then(|s| s.as_str())
                .map(String::from),
            updated_at: r
                .get("updated_at")
                .and_then(|s| s.as_str())
                .map(String::from),
        })
        .collect())
}

fn str_field(v: &Value, k: &str) -> String {
    v.get(k)
        .and_then(|s| s.as_str())
        .map(String::from)
        .unwrap_or_default()
}

#[derive(Debug, Deserialize)]
pub struct CreateRepoInput {
    pub token: String,
    pub name: String,
    #[serde(rename = "isPrivate", default)]
    pub is_private: Option<bool>,
    #[serde(default)]
    pub description: Option<String>,
}

#[tauri::command]
pub async fn auth_create_repo(args: CreateRepoInput) -> Result<GitHubRepo, String> {
    let body = serde_json::json!({
        "name": args.name,
        "private": args.is_private.unwrap_or(true),
        "description": args.description.unwrap_or_else(|| "Notes vault managed by Noteriv".into()),
        "auto_init": true,
    });
    let v = gh_request("POST", "/user/repos", Some(&args.token), Some(body)).await?;
    Ok(GitHubRepo {
        name: str_field(&v, "name"),
        full_name: str_field(&v, "full_name"),
        private: v.get("private").and_then(|b| b.as_bool()).unwrap_or(false),
        clone_url: str_field(&v, "clone_url"),
        ssh_url: str_field(&v, "ssh_url"),
        description: v
            .get("description")
            .and_then(|s| s.as_str())
            .map(String::from),
        updated_at: v
            .get("updated_at")
            .and_then(|s| s.as_str())
            .map(String::from),
    })
}

#[tauri::command]
pub async fn auth_open_token_page(app: tauri::AppHandle) -> bool {
    let _ = app.opener().open_url(
        "https://github.com/settings/tokens/new?scopes=repo&description=Noteriv",
        None::<&str>,
    );
    true
}

#[tauri::command]
pub async fn auth_get_user(vault_id: String) -> Result<Option<GitHubUser>, String> {
    let remote = crate::store::get_vaults()
        .into_iter()
        .find(|v| v.id == vault_id)
        .and_then(|v| v.git_remote);
    if remote
        .as_deref()
        .and_then(|r| noteriv_git::remote_origin(r).ok())
        .as_deref()
        != Some("https://github.com:443")
    {
        return Ok(None);
    }
    let Some(token) = get_token(&vault_id)? else {
        return Ok(None);
    };
    let user = auth_validate_token(token).await;
    if user.valid {
        Ok(Some(user))
    } else {
        Ok(None)
    }
}

/// Only the OAuth protocol endpoints are exposed; requests never follow redirects.
#[tauri::command]
pub async fn auth_oauth_http(url: String, body: HashMap<String, String>) -> Result<Value, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid OAuth endpoint")?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("OAuth endpoints must use HTTPS".into());
    }
    let github = parsed.host_str() == Some("github.com");
    if github && !["/login/device/code", "/login/oauth/access_token"].contains(&parsed.path()) {
        return Err("Invalid GitHub OAuth endpoint".into());
    }
    if !github
        && !(parsed.path() == "/sessions"
            || parsed.path() == "/refresh"
            || (parsed.path().starts_with("/sessions/") && parsed.path().ends_with("/claim")))
    {
        return Err("Invalid OAuth broker endpoint".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Noteriv")
        .build()
        .map_err(|_| "Cannot start OAuth request")?;
    let request = client.post(parsed).header("Accept", "application/json");
    let response = if github {
        request.form(&body)
    } else {
        request.json(&body)
    }
    .send()
    .await
    .map_err(|_| "OAuth request failed")?;
    if !response.status().is_success() {
        return Err("OAuth server rejected the request".into());
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid OAuth response".into())
}

pub async fn network_credentials(id: &str) -> Result<GitCredentials, String> {
    static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _refresh_guard = REFRESH.lock().await;
    let mut creds = get_credentials(id)?.unwrap_or_default();
    if let Some(oauth) = creds.oauth.clone() {
        let expires = oauth["token"]["expiresAt"].as_i64().unwrap_or(i64::MAX);
        if expires <= chrono::Utc::now().timestamp_millis() + 60_000 {
            let refresh = oauth["token"]["refreshToken"]
                .as_str()
                .ok_or("GitHub login expired; sign in again")?;
            let client_id = oauth["config"]["clientId"]
                .as_str()
                .ok_or("Missing GitHub client ID")?;
            let broker = oauth["config"]["brokerUrl"]
                .as_str()
                .filter(|s| !s.is_empty());
            let endpoint = broker
                .map(|s| format!("{}/refresh", s.trim_end_matches('/')))
                .unwrap_or_else(|| "https://github.com/login/oauth/access_token".into());
            let response = auth_oauth_http(
                endpoint,
                HashMap::from([
                    ("client_id".into(), client_id.into()),
                    ("grant_type".into(), "refresh_token".into()),
                    ("refresh_token".into(), refresh.into()),
                ]),
            )
            .await?;
            creds.token = response["access_token"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("GitHub login expired; sign in again")?
                .into();
            let now = chrono::Utc::now().timestamp_millis();
            let new_token = serde_json::json!({ "accessToken": creds.token, "refreshToken": response["refresh_token"], "expiresAt": response["expires_in"].as_i64().map(|s| now + s * 1000), "refreshExpiresAt": response["refresh_token_expires_in"].as_i64().map(|s| now + s * 1000) });
            creds.oauth =
                Some(serde_json::json!({ "config": oauth["config"], "token": new_token }));
            save_credentials(id, &creds)?;
        }
    }
    Ok(creds)
}
