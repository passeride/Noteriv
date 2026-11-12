# Native Git synchronization

Desktop and Android/iOS now use `crates/noteriv-git` (git2-rs/libgit2).
Desktop's existing IPC methods are adapters; mobile uses the local Expo module
in `phone/modules/noteriv-git`. Git does not need to be installed separately.
The old phone per-file REST implementation is no longer the sync entry point.

## Configure a vault

1. Open Settings > Sync. Save an HTTPS or SSH remote URL. Any Git server speaking
   these protocols is supported; provider-specific API detection is unnecessary.
2. Set your Git author name and email on each device. Existing desktop Git author
   configuration continues to work.
3. For HTTPS, save a username and access token. For SSH, save a PEM private key
   and optional passphrase. Desktop can use an SSH agent by leaving the key blank.
   Enter the server's SHA256 host fingerprint after checking it independently.
   The application never accepts unknown SSH host keys automatically.
4. Run sync. The status panel shows the last successful sync, current work,
   changed file paths, ahead/behind counts, errors and unresolved conflicts.

Credentials are bound to the remote's scheme, host and port. Changing servers
requires saving credentials again. GitHub App tokens are used only on
`https://github.com`. TLS certificates remain verified; HTTPS redirects are
not followed with Git credentials. Android exports its TrustManager CA roots
into app-private storage before initializing OpenSSL. Apple uses SecureTransport;
Windows uses WinHTTP.

Local edits are committed before fetching. Fast-forwards use safe checkout.
Diverged histories merge normally. A conflict pauses synchronization and prevents
push. Resolve each file by keeping local or remote in Settings. Both original
versions remain in Git history, including binary files. The last resolution makes
a two-parent merge commit; push is a separate, explicit sync afterward. Existing
rebases and detached HEAD states require attention rather than automatic abort.
Synchronization never deletes the vault to obtain a fresh copy.

The engine has a per-repository process lock. Mobile saves the live editor before
sync and protects edits made while sync was running; it no longer syncs every five
seconds. Automatic mobile sync respects `autoSync` and the configured interval
(minimum one minute). Git sync covers tracked files/attachments, not only markdown.
`.noteriv/` and `.trash/` are locally excluded from new repositories.

## Credentials and migration

Desktop uses Windows Credential Manager, macOS Keychain, or Linux Secret Service
with the keyring crate. Portable desktop builds also use the OS store, not a file
beside the executable. Linux may ask to unlock the user's credential store.

Mobile uses Expo SecureStore (Android Keystore-backed encryption / iOS Keychain).
Existing desktop Base64 token envelopes and mobile AsyncStorage tokens are migrated
on demand. The secure write is read back before the old entry is removed. Errors
are surfaced; there is no plaintext or Base64 fallback. Disconnect, vault deletion
and mobile app reset remove the secure entries too. Tokens and private keys are
never written inside a vault or embedded in Git remote URLs.

## GitHub App sign-in

Create a GitHub App under your own account/organization. Grant repository Contents
read/write and install it only on the repositories you want to synchronize.
Enter its **client ID**, not the app ID, in Settings > Sync. No client secret or
GitHub App private key belongs in desktop/mobile builds.

### Device Flow (no backend)

Enable Device Flow in the GitHub App settings. Leave the broker URL blank.
Noteriv displays GitHub's user code and opens `https://github.com/login/device`.
Polling respects `authorization_pending`, `slow_down`, cancellation and expiry.
Access/refresh tokens and expiration metadata are saved in the secure store.
Expired access tokens refresh directly with GitHub, without a client secret,
which GitHub permits for tokens issued by Device Flow.

### Browser OAuth with an optional broker

`services/github-auth/server.mjs` is a minimal Node 22+ service. Configure the
GitHub App callback URL as `https://YOUR_AUTH_HOST/callback` and run:

```sh
GITHUB_CLIENT_ID=Iv1.example \
GITHUB_CLIENT_SECRET=your-server-side-secret \
PUBLIC_URL=https://YOUR_AUTH_HOST \
PORT=8787 node services/github-auth/server.mjs
```

Put an HTTPS reverse proxy in front of localhost:8787. Set its request timeout and
body size limits, and disable/redact callback query strings in access logs. Enter
that HTTPS origin as the broker URL in Noteriv. The broker is trusted with tokens
during exchange and refresh; host your own if that trust boundary matters.

Each authorization uses a random state, S256 PKCE verifier and a separate random
claim secret. The callback stores the authorization code in a short-lived in-memory
session. The native client claims it with its verifier and claim secret; no token
is placed in a URL, custom scheme or browser storage. Claims expire after ten
minutes and are single-use. The service limits request sizes, sessions and request
rates; it stores no tokens on disk. Restarting it cancels pending logins. Run a
single instance or provide a shared transactional session store before scaling it.
The broker refresh endpoint exchanges only refresh-token grants.

Official protocol references:

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens

## Build

Desktop: `cd desktop && npm ci && npm run build`. Linux builds need the existing
Tauri GTK/WebKit dependencies plus `libdbus-1-dev` for Secret Service. Lockfiles are
included for both Rust manifests.

Android: install Rust, the Android SDK/NDK, `cargo-ndk`, and the targets
`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`. Then:

```sh
cd phone
npm ci
npm run build:git:android
npx expo prebuild --platform android
npx expo run:android
```

On macOS, install the Rust targets `aarch64-apple-ios`, `aarch64-apple-ios-sim`,
`x86_64-apple-ios`, Xcode and CocoaPods. Run `npm run build:git:ios` before
`npx expo prebuild --platform ios` / `npx expo run:ios`. The script produces the
XCFramework used by the local module. Native build outputs are ignored by Git.
Expo Go can still open local notes, but cannot execute the native Git module.

`.github/workflows/git-sync.yml` runs core tests, OAuth tests, desktop checks,
Android native/APK builds, and an unsigned iOS simulator build. Android debug APKs
are uploaded as workflow artifacts. Platform builds and real GitHub authentication
must be checked before treating this as a release.

## Reuse and attribution

This implementation retains upstream Noteriv's IPC/API shape. The mobile secure
migration follows the approach in covuaduongsinh/Noteriv's `phone/lib/storage.ts`,
with the insecure AsyncStorage fallback removed. That fork's commits informed the
commit-before-merge approach and regression cases, rather than merging its much
larger web/product refactor:

- `405d2b32f5e369ab759ac912b071fb6b2fdc9579`: commit before merge on desktop.
- `f6fff45192b93064b580c84824f9c5d45437893c`: preserve concurrent edits/conflicts.
- `b1921a9ecd0bb77e552bea3083912a77100a0349`: deletion/rename and sync simulations.

The source fork and upstream are MIT licensed. The shared Rust engine and native
bridges here are new code.
