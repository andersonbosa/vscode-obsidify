import { createHash } from 'crypto';
import { access, copyFile, rm } from 'node:fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { BookmarkStore, type BookmarkRecord } from './bookmark-store';
import { openIndexDatabase } from './index-database';
import { isMarkdownFile, normalizeRelativePath, normalizeText, resolveWikilinkTarget, stripMarkdownExtension } from './link-resolution';

export interface ParsedWikilink {
  target: string;
  alias?: string;
  start: number;
  length: number;
  line: number;
  snippet: string;
}

export interface IndexedWikilink extends ParsedWikilink {
  sourcePath: string;
  status: 'resolved' | 'ambiguous' | 'missing';
  targetPath?: string;
  candidates: string[];
}

interface VaultFileRecord {
  path: string;
  mtime: number;
  size: number;
  metadataAvailable: boolean;
}

interface CachedFileRow {
  path: string;
  mtime: number;
  size: number;
  needs_reindex: number;
}

interface CachedLinkRow {
  id: number;
  source_path: string;
  target: string;
  alias: string | null;
  start: number;
  length: number;
  line: number;
  snippet: string;
  status: string;
  target_path: string | null;
  candidates_json: string;
}

interface CachedResolutionRow {
  id: number;
  source_path: string;
  target: string;
}

interface OpenSourceDocument {
  text: string;
  isDirty: boolean;
}

const SKIPPED_DIRECTORIES = new Set(['.obsidian', '.git', 'node_modules', '.vscode', '.trash']);
const WIKILINK_PATTERN = /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;

export function parseWikilinks(text: string): ParsedWikilink[] {
  const links: ParsedWikilink[] = [];
  WIKILINK_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKILINK_PATTERN.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const line = (before.match(/\n/g) ?? []).length;
    const lineStart = before.lastIndexOf('\n') + 1;
    const nextBreak = text.indexOf('\n', match.index);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const target = match[1].trim();

    if (!target) {
      continue;
    }

    links.push({
      target,
      alias: match[2]?.trim() || undefined,
      start: match.index,
      length: match[0].length,
      line,
      snippet: text.slice(lineStart, lineEnd).trim()
    });
  }

  return links;
}

export class VaultService {
  private rootPath?: string;
  private files: string[] = [];
  private database?: ReturnType<typeof openIndexDatabase>;
  private bookmarkStore?: BookmarkStore;
  private updateSequence = 0;

  constructor(private readonly storagePath: string, private readonly legacyStoragePath?: string) {}

  get root(): string | undefined {
    return this.rootPath;
  }

  get allFiles(): readonly string[] {
    return this.files;
  }

  async setRoot(rootPath: string | undefined): Promise<void> {
    const nextRoot = rootPath ? path.resolve(rootPath) : undefined;
    if (nextRoot === this.rootPath && (!nextRoot || this.database)) {
      return;
    }

    this.updateSequence += 1;
    this.database?.close();
    this.database = undefined;
    this.bookmarkStore = undefined;
    this.rootPath = undefined;
    this.files = [];
    if (!nextRoot) {
      return;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.storagePath));
    const databaseName = `${createHash('sha256').update(nextRoot).digest('hex')}.sqlite`;
    const databasePath = path.join(this.storagePath, databaseName);
    if (this.legacyStoragePath) {
      await migrateLegacyDatabase(path.join(this.legacyStoragePath, databaseName), databasePath);
    }
    const database = openIndexDatabase(databasePath);
    try {
      this.database = database;
      this.bookmarkStore = new BookmarkStore(database);
      this.rootPath = nextRoot;
      this.files = this.readFilePaths();
    } catch (error) {
      this.database = undefined;
      this.bookmarkStore = undefined;
      this.rootPath = undefined;
      this.files = [];
      database.close();
      throw error;
    }
  }

  dispose(): void {
    this.updateSequence += 1;
    this.database?.close();
    this.database = undefined;
    this.bookmarkStore = undefined;
    this.rootPath = undefined;
    this.files = [];
  }

  relativePath(uri: vscode.Uri): string | undefined {
    if (!this.rootPath || uri.scheme !== 'file') {
      return undefined;
    }

    const relative = path.relative(this.rootPath, uri.fsPath);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return undefined;
    }

    return toPosix(relative);
  }

  getBacklinks(targetPath: string): readonly IndexedWikilink[] {
    return this.queryLinks(
      'SELECT * FROM wikilinks WHERE target_path = ? ORDER BY source_path, line, start',
      normalizeRelativePath(targetPath)
    );
  }

  getOutgoing(sourcePath: string): readonly IndexedWikilink[] {
    return this.queryLinks(
      'SELECT * FROM wikilinks WHERE source_path = ? ORDER BY line, start',
      normalizeRelativePath(sourcePath)
    );
  }

  getBookmarks(): readonly BookmarkRecord[] {
    return this.bookmarkStore?.list() ?? [];
  }

  isBookmarked(relativePath: string): boolean {
    return this.bookmarkStore?.has(relativePath) ?? false;
  }

  toggleBookmark(relativePath: string): boolean {
    return this.bookmarkStore?.toggle(relativePath) ?? false;
  }

  addBookmark(relativePath: string): boolean {
    return this.bookmarkStore?.add(relativePath) ?? false;
  }

  setBookmarkLabel(relativePath: string, label: string | undefined): boolean {
    return this.bookmarkStore?.setLabel(relativePath, label) ?? false;
  }

  removeBookmark(relativePath: string): boolean {
    return this.bookmarkStore?.remove(relativePath) ?? false;
  }

  async refresh(): Promise<void> {
    const rootPath = this.rootPath;
    const database = this.database;
    if (!rootPath || !database) {
      return;
    }

    const sequence = ++this.updateSequence;
    const rootUri = vscode.Uri.file(rootPath);
    const files: VaultFileRecord[] = [];
    await this.walk(rootUri, '', files);

    const openDocuments = new Map<string, OpenSourceDocument>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.languageId !== 'markdown' && !isMarkdownFile(document.uri.fsPath)) {
        continue;
      }
      const relativePath = this.relativePath(document.uri);
      if (relativePath) {
        openDocuments.set(relativePath, { text: document.getText(), isDirty: document.isDirty });
      }
    }

    const cachedFiles = new Map<string, CachedFileRow>();
    const cachedFileRows = database.prepare('SELECT path, mtime, size, needs_reindex FROM vault_files').all() as unknown as CachedFileRow[];
    for (const row of cachedFileRows) {
      cachedFiles.set(row.path, row);
    }

    const reparsedSources = new Map<string, { links: ParsedWikilink[]; needsReindex: boolean }>();
    const failedSources = new Set<string>();
    for (const file of files) {
      if (!isMarkdownFile(file.path)) {
        continue;
      }

      const cached = cachedFiles.get(file.path);
      const openDocument = openDocuments.get(file.path);
      const changedOnDisk = !file.metadataAvailable || !cached || cached.mtime !== file.mtime || cached.size !== file.size;
      if (!changedOnDisk && cached.needs_reindex === 0 && !openDocument?.isDirty) {
        continue;
      }

      const text = openDocument?.isDirty ? openDocument.text : openDocument?.text ?? await this.readText(file.path);
      if (text === undefined) {
        failedSources.add(file.path);
        continue;
      }

      reparsedSources.set(file.path, {
        links: parseWikilinks(text),
        needsReindex: !file.metadataAvailable || Boolean(openDocument?.isDirty)
      });
    }

    if (sequence !== this.updateSequence || database !== this.database || rootPath !== this.rootPath) {
      return;
    }

    const filePaths = files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
    const markdownPaths = filePaths.filter(isMarkdownFile);
    const destinationSetChanged = cachedFiles.size !== filePaths.length || filePaths.some((filePath) => !cachedFiles.has(filePath));
    const insertFile = database.prepare(`
      INSERT INTO vault_files(path, mtime, size, needs_reindex)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        needs_reindex = excluded.needs_reindex
    `);
    const deleteSourceLinks = database.prepare('DELETE FROM wikilinks WHERE source_path = ?');
    const insertLink = database.prepare(`
      INSERT INTO wikilinks(source_path, target, alias, start, length, line, snippet, status, target_path, candidates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const selectLinks = database.prepare('SELECT id, source_path, target FROM wikilinks');
    const updateResolution = database.prepare(`
      UPDATE wikilinks SET status = ?, target_path = ?, candidates_json = ? WHERE id = ?
    `);

    try {
      database.exec('BEGIN IMMEDIATE');
      database.exec(`
        CREATE TEMP TABLE IF NOT EXISTS current_vault_files(path TEXT PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS current_markdown_files(path TEXT PRIMARY KEY);
        DELETE FROM current_vault_files;
        DELETE FROM current_markdown_files;
      `);
      const insertCurrentFile = database.prepare('INSERT INTO current_vault_files(path) VALUES (?)');
      const insertCurrentMarkdown = database.prepare('INSERT INTO current_markdown_files(path) VALUES (?)');
      for (const filePath of filePaths) {
        insertCurrentFile.run(filePath);
      }
      for (const markdownPath of markdownPaths) {
        insertCurrentMarkdown.run(markdownPath);
      }

      for (const file of files) {
        const reparsed = reparsedSources.get(file.path);
        const needsReindex = !file.metadataAvailable || failedSources.has(file.path) || Boolean(reparsed?.needsReindex);
        insertFile.run(file.path, file.mtime, file.size, needsReindex ? 1 : 0);
      }

      database.exec(`
        DELETE FROM wikilinks WHERE source_path NOT IN (SELECT path FROM current_markdown_files);
        DELETE FROM vault_files WHERE path NOT IN (SELECT path FROM current_vault_files);
      `);

      for (const [sourcePath, source] of reparsedSources) {
        deleteSourceLinks.run(sourcePath);
        for (const link of source.links) {
          const resolution = resolveWikilinkTarget(filePaths, sourcePath, link.target);
          insertLink.run(
            sourcePath,
            link.target,
            link.alias ?? null,
            link.start,
            link.length,
            link.line,
            link.snippet,
            resolution.status,
            resolution.targetPath ?? null,
            JSON.stringify(resolution.candidates)
          );
        }
      }

      if (destinationSetChanged) {
        for (const row of selectLinks.iterate() as Iterable<CachedResolutionRow>) {
          const resolution = resolveWikilinkTarget(filePaths, row.source_path, row.target);
          updateResolution.run(resolution.status, resolution.targetPath ?? null, JSON.stringify(resolution.candidates), row.id);
        }
      }
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction error if rollback is unavailable.
      }
      throw error;
    }

    this.files = filePaths;
  }

  resolveTarget(sourcePath: string, target: string): {
    status: IndexedWikilink['status'];
    targetPath?: string;
    candidates: string[];
  } {
    return resolveWikilinkTarget(this.files, sourcePath, target);
  }

  linkTextForFile(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath);
    const basename = path.posix.basename(normalized);
    const title = stripMarkdownExtension(basename);
    const collisions = this.files.filter((file) => normalizeText(stripMarkdownExtension(path.posix.basename(file))) === normalizeText(title));

    if (collisions.length === 1) {
      return isMarkdownFile(normalized) ? title : basename;
    }

    return isMarkdownFile(normalized) ? stripMarkdownExtension(normalized) : normalized;
  }

  async createMarkdownNote(target: string): Promise<vscode.Uri | undefined> {
    if (!this.rootPath) {
      return undefined;
    }

    let relative = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relative) {
      return undefined;
    }

    if (path.posix.extname(relative) && !isMarkdownFile(relative)) {
      return undefined;
    }
    if (!isMarkdownFile(relative)) {
      relative += '.md';
    }

    const absolutePath = path.resolve(this.rootPath, ...relative.split('/'));
    const fromRoot = path.relative(this.rootPath, absolutePath);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      return undefined;
    }

    const uri = vscode.Uri.file(absolutePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(absolutePath)));
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
    await this.refresh();
    return uri;
  }

  private async walk(directoryUri: vscode.Uri, relativeDirectory: string, output: VaultFileRecord[]): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directoryUri);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      if (type === vscode.FileType.SymbolicLink) {
        continue;
      }

      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const entryUri = vscode.Uri.joinPath(directoryUri, name);

      if (type === vscode.FileType.Directory) {
        if (!SKIPPED_DIRECTORIES.has(name.toLowerCase())) {
          await this.walk(entryUri, relativePath, output);
        }
        continue;
      }

      if (type === vscode.FileType.File) {
        let mtime = -1;
        let size = -1;
        let metadataAvailable = false;
        try {
          const stat = await vscode.workspace.fs.stat(entryUri);
          mtime = stat.mtime;
          size = stat.size;
          metadataAvailable = true;
        } catch {
          // Re-read this file on every refresh until its metadata can be read.
        }
        output.push({ path: normalizeRelativePath(relativePath), mtime, size, metadataAvailable });
      }
    }
  }

  private async readText(relativePath: string): Promise<string | undefined> {
    if (!this.rootPath) {
      return undefined;
    }
    try {
      const uri = vscode.Uri.file(path.join(this.rootPath, ...relativePath.split('/')));
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private readFilePaths(): string[] {
    if (!this.database) {
      return [];
    }
    const rows = this.database.prepare('SELECT path FROM vault_files ORDER BY path').all() as unknown as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  private queryLinks(sql: string, value: string): IndexedWikilink[] {
    if (!this.database) {
      return [];
    }
    const rows = this.database.prepare(sql).all(value) as unknown as CachedLinkRow[];
    return rows.map((row) => {
      let candidates: string[] = [];
      try {
        candidates = JSON.parse(row.candidates_json) as string[];
      } catch {
        // Treat a malformed cached candidate list as empty and refresh it on the next scan.
      }
      return {
        sourcePath: row.source_path,
        target: row.target,
        alias: row.alias ?? undefined,
        start: row.start,
        length: row.length,
        line: row.line,
        snippet: row.snippet,
        status: row.status as IndexedWikilink['status'],
        targetPath: row.target_path ?? undefined,
        candidates
      };
    });
  }

}

async function migrateLegacyDatabase(legacyPath: string, currentPath: string): Promise<void> {
  if (await fileExists(currentPath)) {
    return;
  }
  if (!(await fileExists(legacyPath))) {
    return;
  }

  try {
    await copyFile(`${legacyPath}-wal`, `${currentPath}-wal`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await rm(`${currentPath}-wal`, { force: true });
  }
  await copyFile(legacyPath, currentPath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
