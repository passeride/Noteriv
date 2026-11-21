use super::{fail, Path, PathBuf};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
use serde_json::{json, Value};
use std::{fs, io::ErrorKind};

/// Plugin paths are vault-relative. Deny dot-prefixed entries, traversal and
/// symlinks, including symlinks introduced by a checked-out Git repository.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf> {
    if !root.is_dir() || relative.contains(['\\', '\0', ':']) {
        return Err(fail("Invalid plugin vault path").into());
    }
    let mut current = root.canonicalize()?;
    if relative.is_empty() {
        return Ok(current);
    }
    for part in relative.split('/') {
        if part.is_empty() || part.starts_with('.') {
            return Err(fail("Invalid plugin vault path").into());
        }
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

pub fn operation(root: &Path, action: &str, relative: &str, content: &str) -> Result<Value> {
    if (relative.is_empty() && action != "list") || relative.starts_with('/') {
        return Err(fail("A file path is required").into());
    }
    let path = resolve(root, relative.trim_end_matches('/'))?;
    match action {
        "read" => {
            if !path.is_file() {
                return Ok(Value::Null);
            }
            if fs::metadata(&path)?.len() > 2_000_000 {
                return Err(fail("Plugin file exceeds the size limit").into());
            }
            Ok(json!(fs::read_to_string(path)?))
        }
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
        assert!(operation(vault.path(), "read", "link.txt", "").is_err());
        assert!(operation(vault.path(), "write", "folder/secret.txt", "edit").is_err());
        assert_eq!(fs::read_to_string(secret).unwrap(), "private");
        assert_eq!(operation(vault.path(), "list", "", "").unwrap(), json!([]));
    }
}
