# Device verification before release

Use a disposable private repository and a copy of your notes for the first device
checks. Run the desktop and mobile builds from the same PR commit.

| Scenario | Expected result |
| --- | --- |
| Offline edit + commit | Local history works without a Git executable or network. |
| Initial sync to an empty remote | Notes and attachments are committed and pushed. |
| Existing REST-synced mobile vault | Notes are retained; unrelated histories merge or produce explicit conflicts. |
| Remote update with clean local files | Safe fast-forward, open editor and file list refresh. |
| Both devices edit the same note | Push pauses; Settings lists the path; both original versions remain in Git history. |
| Delete on one side, edit on the other | Explicit conflict; either version/deletion can be selected. |
| Binary attachment conflict | No text conversion; selected blob bytes are preserved. |
| Edit while fetching | Current text is retained; a received remote edit gets a separate copy if needed. |
| Network/authentication failure | No successful-sync timestamp is recorded; committed local edits remain available. |
| Concurrent manual and automatic sync | Only one repository mutation runs at a time. |
| HTTPS self-hosted Git | Host, custom port and repository path work without forge API detection. |
| SSH self-hosted Git | Unknown/changed fingerprints are refused; the independently verified fingerprint allows the saved key. |
| Locked/unavailable keychain | Visible error and no plaintext/AsyncStorage fallback. |
| Existing tokens | Secure read-back succeeds before legacy token deletion. |
| Disconnect, delete vault, reset mobile app | Associated SecureStore/keyring entries are removed. |
| GitHub Device Flow | Enable it in the registered GitHub App; code, pending, cancellation and successful login work. |
| Browser OAuth | Registered callback matches broker; state/PKCE/claim are checked; no tokens appear in URLs. |
| Expiring GitHub App token | Refresh rotates the token pair; revoked/expired refresh tokens require sign-in. |

Android APKs from CI include the native engine. Expo Go cannot exercise these
checks. iOS needs a simulator/native build; Keychain and Android Keystore behavior
also need a physical-device check. Real GitHub sign-in requires a registered App
client ID and an installation on the test repository. Browser OAuth additionally
requires the optional HTTPS broker with its server-side client secret.
