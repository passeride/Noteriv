# Noteriv for Emacs

Browse an existing Noteriv vault, search its Markdown, create notes, and capture text without leaving Emacs. Vault discovery, search, and note creation use the Noteriv desktop CLI. Editing uses ordinary Emacs file buffers.

## Install

1. Install the Noteriv desktop app and open a vault. Confirm that `noteriv vaults --json` lists it. If the executable is outside your Emacs `exec-path`, set `noteriv-executable` to the full path to the app binary, including the `.exe` on Windows. A Linux AppImage can also be used as the executable.
2. Run `M-x package-install-file` and select [`noteriv.el`](./noteriv.el). The package uses only built-in Emacs libraries and requires Emacs 27.1 or later.
3. Optionally add this to your Emacs configuration:

   ```elisp
   (with-eval-after-load 'noteriv
     ;; Optional. Use an existing note at this path in the vault.
     (setq noteriv-inbox "Inbox/Capture.md"))
   (noteriv-mode 1)
   ```

## Commands

| Command | Optional shortcut | What it does |
| --- | --- | --- |
| `noteriv-find-note` | `C-c n f` | Completes vault-relative note paths and opens the chosen file in Emacs. |
| `noteriv-search` | `C-c n s` | Searches with Noteriv query syntax and jumps to the selected matching line. |
| `noteriv-create-note` | `C-c n n` | Creates a new note and opens it in Emacs. With an active region, uses it as the initial text. |
| `noteriv-capture` | `C-c n c` | Appends the active region or prompted text to an existing note. `C-u` prompts for a destination even when `noteriv-inbox` is configured. |
| `noteriv-open-in-app` | `C-c n o` | Opens the current note at point in Noteriv. `C-u` prompts for a different note. |
| `noteriv-daily` | `C-c n d` | Opens today's daily note in Noteriv. |
| `noteriv-select-vault` | `C-c n v` | Chooses a vault for subsequent commands. Set `noteriv-vault` to `nil` to resume automatic selection. |

Automatic selection uses the vault containing the current file or directory, then Noteriv's active vault. Note creation fails if the destination already exists. Capture asks you to save any unsaved Emacs edits in the destination buffer before appending.

For search syntax, see the [Noteriv search reference](../../docs/features/search.md#search-queries).

## Tests

```sh
emacs -Q --batch -L integrations/emacs -l noteriv-test -f ert-run-tests-batch-and-exit
```
