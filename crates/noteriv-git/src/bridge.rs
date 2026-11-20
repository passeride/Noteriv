use super::*;
use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    action: String,
    dir: String,
    #[serde(default)]
    credentials: Credentials,
    remote: Option<String>,
    branch: Option<String>,
    name: Option<String>,
    email: Option<String>,
    message: Option<String>,
    path: Option<String>,
    side: Option<String>,
    revision: Option<String>,
}
fn execute(request: &str) -> Result<Value> {
    let req: Request = serde_json::from_str(request).map_err(|_| fail("Invalid Git request"))?;
    let path = Path::new(&req.dir);
    match req.action.as_str() {
        "init" => {
            init(path)?;
            if let Some(branch) = req.branch.as_deref() {
                if !git2::Reference::is_valid_name(&format!("refs/heads/{branch}")) {
                    return Err(fail("Invalid branch"));
                }
                let repo = Repository::open(path)?;
                if repo.head().is_err() {
                    repo.set_head(&format!("refs/heads/{branch}"))?;
                }
            }
            Ok(json!(true))
        }
        "identity" => {
            set_identity(
                path,
                req.name.as_deref().unwrap_or(""),
                req.email.as_deref().unwrap_or(""),
            )?;
            Ok(json!(true))
        }
        "remote" => {
            set_remote(path, req.remote.as_deref().unwrap_or(""))?;
            Ok(json!(true))
        }
        "status" => Ok(json!(status(path)?)),
        "history" => Ok(json!(history(path, 100)?)),
        "show" => Ok(json!(show(
            path,
            req.revision.as_deref().unwrap_or(""),
            req.path.as_deref().unwrap_or("")
        )?)),
        "resolve" => Ok(json!(resolve(
            path,
            req.path.as_deref().unwrap_or(""),
            req.side.as_deref().unwrap_or("")
        )?)),
        _ => Ok(json!(run(
            path,
            &req.action,
            &req.credentials,
            req.message.as_deref().unwrap_or("Sync notes")
        )?)),
    }
}
pub fn dispatch(request: &str) -> String {
    let result = std::panic::catch_unwind(|| execute(request));
    match result {
        Ok(Ok(value)) => json!({"ok":true,"value":value}).to_string(),
        Ok(Err(e)) => json!({"ok":false,"error":e.message()}).to_string(),
        Err(_) => json!({"ok":false,"error":"Git operation failed internally"}).to_string(),
    }
}
/// The caller owns the returned string and must release it with noteriv_git_free.
/// # Safety
/// request must be a valid, NUL-terminated UTF-8 string, alive for this call.
#[no_mangle]
pub unsafe extern "C" fn noteriv_git_execute(request: *const c_char) -> *mut c_char {
    if request.is_null() {
        return std::ptr::null_mut();
    }
    let response = match CStr::from_ptr(request).to_str() {
        Ok(s) => dispatch(s),
        Err(_) => "{\"ok\":false,\"error\":\"Invalid UTF-8\"}".into(),
    };
    CString::new(response)
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}
/// # Safety
/// response must be a live pointer returned by noteriv_git_execute, freed once.
#[no_mangle]
pub unsafe extern "C" fn noteriv_git_free(response: *mut c_char) {
    if !response.is_null() {
        drop(CString::from_raw(response));
    }
}
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_expo_modules_noterivgit_NativeGit_execute(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    input: jni::objects::JString,
) -> jni::sys::jstring {
    let input: String = match env.get_string(&input) {
        Ok(s) => s.into(),
        Err(_) => return std::ptr::null_mut(),
    };
    env.new_string(dispatch(&input))
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_expo_modules_noterivgit_NativeGit_initialize(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    ca_file: jni::objects::JString,
) -> jni::sys::jboolean {
    // Called exactly once under the Kotlin module's process-wide monitor,
    // before executing any repository operation. OpenSSL uses Android's trust
    // manager roots rather than a nonexistent desktop CA directory.
    static READY: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let path: String = match env.get_string(&ca_file) {
        Ok(s) => s.into(),
        Err(_) => return 0,
    };
    let ready =
        READY.get_or_init(|| unsafe { git2::opts::set_ssl_cert_file(Path::new(&path)).is_ok() });
    if *ready {
        1
    } else {
        0
    }
}
