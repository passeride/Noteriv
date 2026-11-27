---
title: Note History
order: 10
---

# Note History

Use **Git: File history** in the command palette to see commits for the current file. On mobile, the same command is available when viewing attachments. On desktop, note history also lets you inspect and compare past text versions.

## Prerequisites

Note history requires:

1. **A Git repository.** Your vault must be initialized as a Git repo (`git init` in the vault root, or let Noteriv's setup wizard handle it).
2. **Commits in the local repository.** Noteriv can read commits made through sync or through another Git client. The native Git module reads the local repository on desktop and mobile.

If any of these are missing, the note history panel will show an empty state.

## Opening Note History

Open the command palette and search for **Git: File history**. On mobile, you can also open it from Note details.

## Folder activity in a note

Use a `githistory` block in a note to show when a folder and its descendants changed. For example:

````markdown
```githistory
folder: Prosjekt/Discyboi
```
````

Enter `.*.*` or leave the block empty to use the folder containing the note. Enter `/` for the whole vault. The chart shows the first and last commit dates and the number of commits per day or month, including gaps. A commit that touches several files in the folder counts once. Deleted files still contribute to the folder's activity.

## Sort the file browser

**Last change** uses the most recent Git commit for a tracked file or for changes inside a tracked folder. Untracked entries and local vaults use filesystem modification times. **Manual** reads a hidden `.order` file in each folder, with one immediate file or folder name per line. Reorder with drag and drop on desktop or with **Move up** and **Move down** in a file or folder's long-press menu on mobile.

## Commit Timeline

The history panel displays a chronological list of every commit that touched the current file. Each entry shows:

- **Commit hash.** The short SHA identifying the commit.
- **Author.** The name of the person who made the commit.
- **Date.** When the commit was created, formatted as a human-readable date and time.
- **Message.** The commit message, typically describing what changed.

The list is ordered newest-first, so the most recent change is at the top.

### Following Renames

File history follows renames detected by the native Git library. If you renamed `old-name.md` to `new-name.md`, the history of `new-name.md` can include commits from before the rename.

## Viewing Content at a Commit

Click any entry in the commit timeline to load the file's content as it existed at that commit. The content is retrieved using `git show {hash}:{file-path}` and displayed in a preview pane.

This is a read-only view -- you cannot edit the historical content directly. If you want to restore it, copy the content and paste it into the editor, or use [File Recovery](./file-recovery.md) for more recent changes.

## Diff Between Versions

Select two commits in the timeline to see a diff between them. The diff is computed using a line-based Longest Common Subsequence (LCS) algorithm and displayed with color coding:

- **Green lines** (`add`) -- content present in the newer version but not the older one.
- **Red lines** (`remove`) -- content present in the older version but not the newer one.
- **Unchanged lines** (`same`) -- content identical in both versions.

The diff gives you a precise view of what was added, removed, or rewritten between any two points in the file's history.

### Diff Algorithm

Noteriv uses a custom LCS-based diff rather than calling `git diff`. The algorithm:

1. Splits both versions into lines.
2. Builds a dynamic programming table to find the longest common subsequence.
3. Backtraces through the table to produce a sequence of `same`, `add`, and `remove` entries.

This runs entirely in the browser, so there is no round-trip to the Git CLI for diffs. The result is identical in substance to `git diff` for line-level comparisons.

## Note History vs. File Recovery

These two features serve different purposes and complement each other:

| | Note History | File Recovery |
|---|---|---|
| Backend | Git commits | Local `.noteriv/snapshots/` files |
| Requires Git | Yes | No |
| Granularity | Per-commit (per-sync) | Per-save |
| Retention | Unlimited (full Git history) | 50 snapshots, 30-day default |
| Tracks renames | Yes (`--follow`) | No |
| Diff view | Yes (LCS-based) | Yes (preview comparison) |
| Use case | Long-term history, collaboration audit | Quick undo of recent work |

Use file recovery when you just overwrote something and need it back immediately. Use note history when you want to understand how a file evolved over weeks or months, or when you need to identify who changed what in a collaborative vault.

## When History Is Empty

The history panel shows an empty state when:

- The file has never been committed (it exists only as an untracked file in Git).
- The vault is not a Git repository.
- The Git backend call fails for any reason (permissions, corrupt repo, etc.).

In all these cases, [File Recovery](./file-recovery.md) may still have snapshots available.

## Workflow Example

A typical workflow combining sync and history:

1. Write notes throughout the day.
2. Press `Ctrl+Shift+G` to sync (commit + push) periodically.
3. Days later, you realize a section was better in a previous version.
4. Open the command palette, select "Note History".
5. Browse the commit timeline to find the version you want.
6. Click to preview the content at that commit.
7. Diff it against the current version to confirm what changed.
8. Copy the relevant section and paste it back into the current file.

## Tips

- **Sync frequently.** Each sync creates a commit, which becomes a point in the timeline. If you only sync once a week, you have only one historical point per week.
- **Write meaningful commit messages.** Noteriv's sync uses automated messages by default, but meaningful messages make the timeline much easier to navigate.
- **Use diff for reviews.** Before publishing or sharing a note, diff the current version against the last synced version to see all changes at a glance.
- **Combine both history tools.** Use file recovery for "I just broke this" moments and note history for "what did this look like last month" questions.
- **Check `--follow` for renamed files.** If you renamed a note and wonder where its old history went, note history tracks through renames automatically.
