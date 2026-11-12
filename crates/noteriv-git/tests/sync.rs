use git2::Repository;
use noteriv_git::{self as engine, Credentials};
use std::{fs, path::Path};
fn vault() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    engine::init(dir.path()).unwrap();
    engine::set_identity(dir.path(), "Test", "test@example.com").unwrap();
    fs::write(dir.path().join("note.md"), "base\n").unwrap();
    engine::run(dir.path(), "commit", &Credentials::default(), "base").unwrap();
    dir
}
// Exercise real libgit2 merges against local bare repos; production URL validation
// intentionally rejects file transport, so tests fetch/push the fixture directly.
fn transport(path: &Path, push: bool) {
    let repo = Repository::open(path).unwrap();
    let branch = repo.head().unwrap().shorthand().unwrap().to_string();
    let mut remote = repo.find_remote("origin").unwrap();
    if push {
        remote
            .push(&[&format!("refs/heads/{branch}:refs/heads/{branch}")], None)
            .unwrap();
    } else {
        remote
            .fetch(&["+refs/heads/*:refs/remotes/origin/*"], None, None)
            .unwrap();
    }
}
#[test]
fn history_and_offline_commits_need_no_git_binary() {
    let dir = vault();
    fs::write(dir.path().join("note.md"), "edited\n").unwrap();
    assert_eq!(engine::status(dir.path()).unwrap().changes, 1);
    engine::run(dir.path(), "commit", &Credentials::default(), "edit").unwrap();
    let log = engine::history(dir.path(), 20).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(
        engine::show(dir.path(), &log[1].hash, "note.md").unwrap(),
        "base\n"
    );
}
#[test]
fn failed_fetch_keeps_local_changes_in_history() {
    let dir = vault();
    engine::set_remote(dir.path(), "https://127.0.0.1:1/no.git").unwrap();
    fs::write(dir.path().join("note.md"), "unsynced\n").unwrap();
    assert!(engine::run(
        dir.path(),
        "sync",
        &Credentials::default(),
        "save before fetch"
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("note.md")).unwrap(),
        "unsynced\n"
    );
    assert_eq!(engine::history(dir.path(), 20).unwrap().len(), 2);
    assert!(engine::status(dir.path())
        .unwrap()
        .sync
        .last_success
        .is_none());
    assert!(engine::status(dir.path())
        .unwrap()
        .sync
        .last_error
        .is_some());
}
#[test]
fn remotes_reject_embedded_secrets_and_unsafe_transports() {
    for url in [
        "https://user:secret@host/repo",
        "file:///tmp/repo",
        "http://host/repo",
        "ext::command",
        "--upload-pack=bad",
    ] {
        assert!(engine::validate_remote(url).is_err(), "{url}");
    }
    for url in [
        "https://forgejo.example/team/repo.git",
        "git@host:team/repo.git",
        "ssh://git@host:2222/team/repo.git",
    ] {
        engine::validate_remote(url).unwrap();
    }
}
#[test]
fn conflict_resolution_keeps_two_parent_history() {
    let ours = vault();
    let remote = tempfile::tempdir().unwrap();
    Repository::init_bare(remote.path()).unwrap();
    let repo = Repository::open(ours.path()).unwrap();
    repo.remote("origin", remote.path().to_str().unwrap())
        .unwrap();
    transport(ours.path(), true);
    let theirs = tempfile::tempdir().unwrap();
    let other = Repository::clone(remote.path().to_str().unwrap(), theirs.path()).unwrap();
    engine::set_identity(theirs.path(), "Other", "other@example.com").unwrap();
    fs::write(theirs.path().join("note.md"), "theirs\n").unwrap();
    engine::run(theirs.path(), "commit", &Credentials::default(), "other").unwrap();
    transport(theirs.path(), true);
    fs::write(ours.path().join("note.md"), "ours\n").unwrap();
    engine::run(ours.path(), "commit", &Credentials::default(), "ours").unwrap();
    transport(ours.path(), false);
    let branch = other.head().unwrap().shorthand().unwrap().to_string();
    let target = repo
        .find_reference(&format!("refs/remotes/origin/{branch}"))
        .unwrap()
        .target()
        .unwrap();
    let annotated = repo.find_annotated_commit(target).unwrap();
    repo.merge(&[&annotated], None, None).unwrap();
    assert_eq!(
        engine::status(ours.path()).unwrap().conflicts,
        vec!["note.md"]
    );
    assert!(engine::run(ours.path(), "commit", &Credentials::default(), "bad").is_err());
    let result = engine::resolve(ours.path(), "note.md", "theirs").unwrap();
    assert!(result.conflicts.is_empty());
    assert_eq!(
        repo.head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .parent_count(),
        2
    );
    assert_eq!(
        fs::read_to_string(ours.path().join("note.md")).unwrap(),
        "theirs\n"
    );
    assert!(engine::resolve(ours.path(), "../outside", "ours").is_err());
}
