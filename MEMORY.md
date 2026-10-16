# Obsidify project memory

- v1 renamed the extension ID and setting/command namespace to `andersonbosa.obsidify` / `obsidify.*`. On first startup it migrates old `obsidianfy.*` settings and copies each per-vault SQLite database from the legacy global-storage folder; old command IDs remain aliases. VS Code treats the renamed ID as a separate extension, so users should remove the old installed entry after installing Obsidify.

## Wikilink index

- `VaultService` in `src/vault.ts` owns the index and stores it in SQLite via Node's built-in `node:sqlite` `DatabaseSync` API; there is no native SQLite npm dependency.
- The database is created under the extension's `context.globalStorageUri`, with a SHA-256 filename derived from the resolved vault path. Different vault roots get separate databases, and the index survives VS Code restarts.
- `vault_files` stores relative paths, file modification time, size, and a `needs_reindex` flag. `wikilinks` stores parsed link text, source location/snippet, resolution status, target path, and candidate paths. `bookmarks` stores unique vault-relative file paths in insertion order plus an optional display label. Schema version 2 added bookmarks; version 3 added the optional label without replacing existing data.
- Every refresh walks the configured folder with `vscode.workspace.fs`, skips `.obsidian`, `.git`, `node_modules`, `.vscode`, and `.trash`, and records all files as possible destinations. Markdown sources parse `[[target]]` and `[[target|alias]]`; resolution lives in `src/link-resolution.ts`.
- The refresh compares the current file list and file metadata with SQLite, reparses only changed/new Markdown files (plus dirty open documents), removes deleted paths, and re-resolves cached links when the destination file set changes. Open Markdown buffers supply their current text; unsaved-buffer entries are marked for reindex so disk contents replace them on a later refresh/startup.
- SQLite persists link data, but refresh still walks and stats the vault to discover changes made while VS Code was closed. It avoids rereading/reparsing unchanged Markdown; do not describe startup as requiring no scan or promise a measured speedup without benchmarking.
- `node:sqlite` requires the Node 22 extension host, so `package.json` declares VS Code `^1.101.0` as the minimum engine.

## Sidebar behavior

- Backlinks and Outgoing Links have independent settings under `obsidify.backlinks.*` and `obsidify.outgoingLinks.*`.
- Bookmarks settings live independently under `obsidify.bookmarks.*`. It supports list/tree, name ascending/descending, path, and bookmark insertion order; tree mode has its own expand/collapse-all state.
- The Bookmarks view `+` action adds the active editor file. Bookmark labels are optional; when empty, the filename is displayed. Rename and remove actions are available in each bookmark's context menu.
- Any file inside the vault can be bookmarked from the active editor, Explorer context menu, or Command Palette. Missing paths remain in the list as unavailable and can be removed from the bookmark item's context menu.
- Tree folders are generated from source folders for backlinks and destination folders for outgoing links. List/tree and sort settings should remain independent per view.
- The expand/collapse-all state is transient per view. When changing all folders, refresh folder item IDs so VS Code applies the requested initial `TreeItemCollapsibleState` instead of preserving prior expansion state.

## Deferred feature

- `TODO.md` tracks future Markdown preview support: render `[[Paralelismo]]` as a clickable link in the VS Code Markdown preview. This is not implemented in the current version.
