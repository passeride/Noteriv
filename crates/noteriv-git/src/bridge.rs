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
    operation: Option<String>,
    content: Option<String>,
}
fn execute(request: &str) -> Result<Value> {
    let req: Request = serde_json::from_str(request).map_err(|_| fail("Invalid Git request"))?;
    let path = Path::new(&req.dir);
    match req.action.as_str() {
        "pluginVault" => plugin_vault::operation(
            path,
            req.operation.as_deref().unwrap_or(""),
            req.path.as_deref().unwrap_or(""),
            req.content.as_deref().unwrap_or(""),
        )
        .map_err(|error| fail(&error.to_string())),
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
        "fileHistory" => Ok(json!(file_history(
            path,
            req.path.as_deref().unwrap_or(""),
            100
        )?)),
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
fn register_android_roots(
    env: &mut jni::JNIEnv,
    roots: &jni::objects::JObjectArray,
) -> std::result::Result<(), String> {
    use jni::objects::JByteArray;
    use libgit2_sys as raw;
    use openssl_sys as ssl;
    use std::ptr::null_mut;

    let count = env.get_array_length(roots).map_err(|err| err.to_string())?;
    if count == 0 {
        return Err("Android supplied no trusted CA certificates".into());
    }

    raw::init();
    for index in 0..count {
        let root = env
            .get_object_array_element(roots, index)
            .map_err(|err| err.to_string())?;
        let root = JByteArray::from(root);
        let der = env.convert_byte_array(&root);
        env.delete_local_ref(root).map_err(|err| err.to_string())?;
        let der = der.map_err(|err| err.to_string())?;
        let mut bytes = der.as_ptr();
        // The Android OpenSSL build has no stdio. Decode DER in memory and
        // let libgit2's certificate store retain its own reference.
        unsafe {
            let cert = ssl::d2i_X509(null_mut(), &mut bytes, der.len() as std::ffi::c_long);
            if cert.is_null() {
                return Err("OpenSSL could not decode an Android CA certificate".into());
            }
            let result = raw::git_libgit2_opts(raw::GIT_OPT_ADD_SSL_X509_CERT as _, cert);
            ssl::X509_free(cert);
            if result < 0 {
                return Err(git2::Error::last_error(result).message().into());
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_expo_modules_noterivgit_NativeGit_initialize(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    roots: jni::objects::JObjectArray,
) -> jni::sys::jstring {
    // Kotlin serializes initialization before any repository operation.
    match register_android_roots(&mut env, &roots) {
        Ok(()) => std::ptr::null_mut(),
        Err(error) => match env.new_string(&error) {
            Ok(message) => message.into_raw(),
            Err(_) => {
                let _ = env.throw_new(
                    "java/lang/IllegalStateException",
                    "Cannot initialize Git TLS",
                );
                std::ptr::null_mut()
            }
        },
    }
}
