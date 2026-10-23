# Obsidify

Obsidian-style `[[wikilinks]]`, file navigation, autocomplete, and backlinks for Markdown files in VS Code.

## MVP features

- Resolve links such as `[[Modelo OSI]]`, `[[folder/Note.md]]`, and `[[document.pdf]]`.
- Support display aliases such as `[[Modelo OSI|OSI model]]`.
- Navigate with Ctrl/Cmd-click and get file suggestions after typing `[[`.
- Insert a wikilink to a vault file with **Obsidify: Insert Wikilink**.
- Browse backlinks and outgoing links in the Obsidify sidebar.
- Bookmark any file in the vault and reopen it from a persistent Bookmarks view.
- Add the open file to Bookmarks with the `+` view button, or add/remove bookmarks from the Command Palette, editor title, Explorer, or a bookmark's context menu.
- Give each bookmark a custom display name from its context menu; empty names use the file name.
- Switch the sidebar between a flat list and a folder tree.
- Expand or collapse all folders in tree view.
- Choose sorting by name, path, or link order independently for each sidebar view.
- Refresh links from an icon in the view toolbar; open Obsidify settings from the `...` menu.
- Create a missing Markdown note from a broken wikilink.
- Refresh the index as Markdown files change.

## Use with a vault

Open the vault folder in VS Code. If the vault is not the workspace folder, run **Obsidify: Choose Vault Folder** or set `obsidify.vaultPath` to its absolute path in VS Code settings.

The extension indexes Markdown files as link sources and all files as possible destinations. The `.obsidian`, `.git`, `node_modules`, `.vscode`, and `.Trash` folders are skipped.

## Persistent index

Obsidify stores its index in a SQLite database under VS Code's extension global storage, using a separate database for each vault. It keeps file metadata and parsed wikilinks between restarts, then checks the vault for additions, changes, and deletions on refresh. Unchanged Markdown files do not need to be read and parsed again.

Bookmarks are stored in the same per-vault database and remain available after restarting VS Code. If a bookmarked file disappears, it stays in the list as unavailable until removed.

This uses Node.js's built-in SQLite API in the VS Code extension host and requires VS Code 1.101 or later.

## Upgrade from Obsidianfy

Obsidify copies the existing per-vault SQLite index and bookmarks from the old `andersonbosa.obsidianfy` storage folder when each vault is first opened. It also migrates `obsidianfy.*` settings and keeps aliases for the old command IDs. Because VS Code treats the new extension ID separately, uninstall the old Obsidianfy entry before installing Obsidify to avoid duplicate sidebar views.

## Install from a VSIX

Choose **Extensions: Install from VSIX...** from the VS Code Command Palette and select `build/obsidify-1.0.0.vsix`.

## Package locally

```sh
npm install
npm test
npm run package
```
