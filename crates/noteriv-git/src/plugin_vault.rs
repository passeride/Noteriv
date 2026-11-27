use super::{fail, Path, PathBuf};
use base64::{engine::general_purpose::STANDARD, Engine as _};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
use serde_json::{json, Value};
use std::{
    fs,
    io::{ErrorKind, Read},
};

/// Plugin paths are vault-relative. Deny dot-prefixed entries, traversal and
/// symlinks, including symlinks introduced by a checked-out Git repository.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf> {
    if !root.is_dir() || relative.contains(['\\', '\0', ':']) {
        return Err(fail("Invalid plugin vault path").into());
    }
    if relative.is_empty() {
        return Ok(root.canonicalize()?);
    }
    let parts = relative.split('/');
    if parts
        .clone()
        .any(|part| part.is_empty() || part.starts_with('.'))
    {
        return Err(fail("Invalid plugin vault path").into());
    }
    resolve_parts(root, parts)
}

fn resolve_parts<'a>(root: &Path, parts: impl IntoIterator<Item = &'a str>) -> Result<PathBuf> {
    let mut current = root.canonicalize()?;
    for part in parts {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(fail("Plugin paths cannot follow symlinks").into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(current)
}

fn valid_asset_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    name.len() <= 101
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

pub fn read_asset(root: &Path, plugin_id: &str, name: &str) -> Result<Value> {
    if !root.is_dir() || !valid_asset_name(plugin_id) || !valid_asset_name(name) {
        return Err(fail("Expected an asset name within the plugin folder.").into());
    }
    read_text(
        resolve_parts(root, [".noteriv", "plugins", plugin_id, name])?,
        131_072,
    )
}

fn read_bytes(path: PathBuf, max_size: u64) -> Result<Option<Vec<u8>>> {
    if !path.is_file() {
        return Ok(None);
    }
    // Bound the actual read as well as checking its length, in case the file
    // changes while a plugin is loading it.
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max_size + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_size {
        return Err(fail("Plugin file exceeds the size limit").into());
    }
    Ok(Some(bytes))
}

fn read_text(path: PathBuf, max_size: u64) -> Result<Value> {
    match read_bytes(path, max_size)? {
        Some(bytes) => Ok(json!(String::from_utf8(bytes)?)),
        None => Ok(Value::Null),
    }
}

pub fn operation(root: &Path, action: &str, relative: &str, content: &str) -> Result<Value> {
    if (relative.is_empty() && action != "list") || relative.starts_with('/') {
        return Err(fail("A file path is required").into());
    }
    let path = resolve(root, relative.trim_end_matches('/'))?;
    match action {
        "read" => read_text(path, 2_000_000),
        "readBinary" => Ok(json!(
            read_bytes(path, 20 * 1024 * 1024)?.map(|bytes| STANDARD.encode(bytes))
        )),
        "exists" => Ok(json!(path.exists())),
        "write" => {
            if content.len() > 2_000_000 {
                return Err(fail("Plugin file exceeds the size limit").into());
            }
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)?;
            Ok(json!(true))
        }
        "delete" => {
            if !path.is_file() {
                return Ok(json!(false));
            }
            let trash = resolve(root, "Plugin Trash")?;
            fs::create_dir_all(&trash)?;
            let name = path.file_name().ok_or_else(|| fail("Invalid file name"))?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| fail("Invalid system time"))?
                .as_nanos();
            let destination = trash.join(format!("{stamp}-{}", name.to_string_lossy()));
            fs::rename(path, destination)?;
            Ok(json!(true))
        }
        "list" => {
            if !path.is_dir() {
                return Ok(json!([]));
            }
            let mut entries = Vec::new();
            let prefix = relative.trim_end_matches('/');
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                let kind = entry.file_type()?;
                if name.starts_with('.') || kind.is_symlink() {
                    continue;
                }
                let path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                entries.push(json!({ "path": path, "name": name, "isDir": kind.is_dir() }));
            }
            Ok(json!(entries))
        }
        _ => Err(fail("Unknown plugin vault operation").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_reads_preserve_bytes_and_respect_vault_and_size_limits() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        fs::write(root.join("model.stl"), [0, 128, 255]).unwrap();
        assert_eq!(
            operation(root, "readBinary", "model.stl", "").unwrap(),
            json!("AID/")
        );
        assert_eq!(
            operation(root, "readBinary", "missing.stl", "").unwrap(),
            Value::Null
        );
        assert!(operation(root, "readBinary", "../outside.stl", "").is_err());
        fs::File::create(root.join("large.step"))
            .unwrap()
            .set_len(20 * 1024 * 1024 + 1)
            .unwrap();
        assert!(operation(root, "readBinary", "large.step", "").is_err());
    }

    #[test]
    fn text_operations_stay_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(
            operation(root, "write", "notes/a.md", "hello").unwrap(),
            json!(true)
        );
        assert_eq!(
            operation(root, "read", "notes/a.md", "").unwrap(),
            json!("hello")
        );
        assert_eq!(
            operation(root, "list", "notes", "").unwrap(),
            json!([{ "path": "notes/a.md", "name": "a.md", "isDir": false }])
        );
        for path in ["../outside.md", ".git/config", "/tmp/file", "notes/../a.md"] {
            assert!(operation(root, "write", path, "no").is_err());
        }
        assert_eq!(
            operation(root, "delete", "notes/a.md", "").unwrap(),
            json!(true)
        );
        assert_eq!(
            operation(root, "exists", "notes/a.md", "").unwrap(),
            json!(false)
        );
        assert_eq!(fs::read_dir(root.join("Plugin Trash")).unwrap().count(), 1);
    }

    #[test]
    fn reads_small_assets_from_the_installation_folder() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        let plugin = root.join(".noteriv/plugins/example");
        fs::create_dir_all(&plugin).unwrap();
        fs::write(plugin.join("engine.txt"), "offline engine").unwrap();
        fs::write(plugin.join("large.txt"), vec![b'x'; 131_073]).unwrap();

        assert_eq!(
            read_asset(root, "example", "engine.txt").unwrap(),
            json!("offline engine")
        );
        assert_eq!(
            read_asset(root, "example", "missing.txt").unwrap(),
            Value::Null
        );
        assert!(read_asset(root, "example", "large.txt").is_err());
        assert!(read_asset(root, "../other", "engine.txt").is_err());
        assert!(read_asset(root, "example", "../engine.txt").is_err());
        assert!(read_asset(root, "example", ".hidden").is_err());
        assert!(operation(root, "read", ".noteriv/plugins/example/engine.txt", "").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_to_files_and_directories() {
        use std::os::unix::fs::symlink;
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, "private").unwrap();
        symlink(&secret, vault.path().join("link.txt")).unwrap();
        symlink(outside.path(), vault.path().join("folder")).unwrap();
        let plugin = vault.path().join(".noteriv/plugins/example");
        fs::create_dir_all(&plugin).unwrap();
        symlink(&secret, plugin.join("asset.txt")).unwrap();
        symlink(outside.path(), plugin.parent().unwrap().join("outside")).unwrap();
        assert!(read_asset(vault.path(), "example", "asset.txt").is_err());
        assert!(read_asset(vault.path(), "outside", "secret.txt").is_err());
        assert!(operation(vault.path(), "read", "link.txt", "").is_err());
        assert!(operation(vault.path(), "write", "folder/secret.txt", "edit").is_err());
        assert_eq!(fs::read_to_string(secret).unwrap(), "private");
        assert_eq!(operation(vault.path(), "list", "", "").unwrap(), json!([]));
    }
}
