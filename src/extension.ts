import * as path from 'path';
import * as vscode from 'vscode';
import { VaultService, parseWikilinks } from './vault';

interface LinkCommandArguments {
  target: string;
  sourcePath: string;
}

class BacklinksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private expandedAll = false;
  private folderGeneration = 0;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly vault: VaultService, private readonly activeEditor: () => vscode.TextEditor | undefined) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  toggleExpandedAll(): void {
    this.expandedAll = !this.expandedAll;
    this.folderGeneration += 1;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element instanceof FolderTreeItem) {
      return element.children;
    }
    if (element) {
      return [];
    }

    const editor = this.activeEditor();
    const relativePath = editor ? this.vault.relativePath(editor.document.uri) : undefined;
    if (!relativePath) {
      return [infoItem('Open a Markdown file in the configured vault to see backlinks.')];
    }

    const backlinks = this.vault.getBacklinks(relativePath);
    if (backlinks.length === 0) {
      return [infoItem('No notes link to this file yet.')];
    }

    const options = getViewOptions('backlinks');
    const rows = backlinks.map((link): ViewRow => {
      const item = new vscode.TreeItem(
        `${path.posix.basename(link.sourcePath)}  ·  line ${link.line + 1}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = clip(link.snippet, 90);
      item.tooltip = `${link.sourcePath}:${link.line + 1}\n${link.snippet}`;
      item.iconPath = new vscode.ThemeIcon('references');
      item.command = {
        command: 'obsidify.openAtLocation',
        title: 'Open Backlink',
        arguments: [link.sourcePath, link.line]
      };
      return {
        item,
        name: path.posix.basename(link.sourcePath),
        sortPath: link.sourcePath,
        folderPath: path.posix.dirname(link.sourcePath) === '.' ? '' : path.posix.dirname(link.sourcePath),
        order: `${link.sourcePath}\0${String(link.line).padStart(8, '0')}`
      };
    });

    return buildRows(rows, options, this.expandedAll, this.folderGeneration);
  }
}

class OutgoingLinksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private expandedAll = false;
  private folderGeneration = 0;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly vault: VaultService, private readonly activeEditor: () => vscode.TextEditor | undefined) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  toggleExpandedAll(): void {
    this.expandedAll = !this.expandedAll;
    this.folderGeneration += 1;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element instanceof FolderTreeItem) {
      return element.children;
    }
    if (element) {
      return [];
    }

    const editor = this.activeEditor();
    const relativePath = editor ? this.vault.relativePath(editor.document.uri) : undefined;
    if (!relativePath) {
      return [infoItem('Open a Markdown file in the configured vault to see its links.')];
    }

    const links = this.vault.getOutgoing(relativePath);
    if (links.length === 0) {
      return [infoItem('This file has no wikilinks yet.')];
    }

    const options = getViewOptions('outgoingLinks');
    const rows = links.map((link): ViewRow => {
      const label = link.alias || link.target;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.tooltip = `${link.sourcePath}:${link.line + 1}\n${link.snippet}`;
      item.description = link.status === 'resolved'
        ? link.targetPath
        : link.status === 'ambiguous'
          ? `Choose destination · ${link.candidates.length} matches`
          : 'Missing target';
      item.iconPath = new vscode.ThemeIcon(link.status === 'resolved' ? 'link' : link.status === 'ambiguous' ? 'question' : 'warning');

      if (link.status === 'missing') {
        item.command = {
          command: 'obsidify.createTarget',
          title: 'Create Missing Note',
          arguments: [{ target: link.target, sourcePath: link.sourcePath } satisfies LinkCommandArguments]
        };
      } else {
        item.command = {
          command: 'obsidify.openTarget',
          title: 'Open Wikilink Target',
          arguments: [{ target: link.target, sourcePath: link.sourcePath } satisfies LinkCommandArguments]
        };
      }

      const folderPath = link.status === 'resolved' && link.targetPath
        ? path.posix.dirname(link.targetPath)
        : link.status === 'ambiguous'
          ? 'Ambiguous targets'
          : 'Missing targets';
      return {
        item,
        name: label,
        sortPath: link.targetPath ?? link.candidates[0] ?? link.target,
        folderPath: folderPath === '.' ? '' : folderPath,
        order: String(link.line).padStart(8, '0')
      };
    });

    return buildRows(rows, options, this.expandedAll, this.folderGeneration);
  }
}

class BookmarkTreeItem extends vscode.TreeItem {
  constructor(label: string, readonly bookmarkPath: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'obsidify.bookmark';
  }
}

class BookmarksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private expandedAll = false;
  private folderGeneration = 0;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly vault: VaultService) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  toggleExpandedAll(): void {
    this.expandedAll = !this.expandedAll;
    this.folderGeneration += 1;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element instanceof FolderTreeItem) {
      return element.children;
    }
    if (element) {
      return [];
    }

    const existingFiles = new Set(this.vault.allFiles);
    const bookmarks = this.vault.getBookmarks();
    if (bookmarks.length === 0) {
      return [infoItem('No bookmarks yet. Open a file and use + here, or run “Obsidify: Toggle Bookmark”.')];
    }

    const options = getViewOptions('bookmarks');
    const rows = bookmarks.map((bookmark): ViewRow => {
      const name = bookmark.label?.trim() || path.posix.basename(bookmark.path);
      const directory = path.posix.dirname(bookmark.path);
      const unavailable = !existingFiles.has(bookmark.path);
      const item = new BookmarkTreeItem(name, bookmark.path);
      item.description = unavailable ? `Unavailable · ${bookmark.path}` : directory === '.' ? '' : directory;
      item.tooltip = unavailable ? `${bookmark.path}\nThis file is no longer in the vault.` : bookmark.path;
      item.iconPath = new vscode.ThemeIcon(unavailable ? 'warning' : 'bookmark');
      if (!unavailable) {
        item.command = {
          command: 'obsidify.openBookmark',
          title: 'Open Bookmark',
          arguments: [bookmark.path]
        };
      }

      return {
        item,
        name,
        sortPath: bookmark.path,
        folderPath: directory === '.' ? '' : directory,
        order: String(bookmark.order).padStart(12, '0'),
        folderOrder: String(bookmark.order).padStart(12, '0')
      };
    });

    return buildRows(rows, options, this.expandedAll, this.folderGeneration);
  }
}

type ViewMode = 'list' | 'tree';
type SortOrder = 'nameAsc' | 'nameDesc' | 'pathAsc' | 'linkOrder';
type ViewId = 'backlinks' | 'outgoingLinks' | 'bookmarks';
type LegacyViewId = 'backlinks' | 'outgoingLinks';

interface ViewRow {
  item: vscode.TreeItem;
  name: string;
  sortPath: string;
  folderPath: string;
  order: string;
  folderOrder?: string;
}

interface ViewOptions {
  mode: ViewMode;
  sortOrder: SortOrder;
}

class FolderTreeItem extends vscode.TreeItem {
  constructor(label: string, readonly children: vscode.TreeItem[], expanded: boolean, id: string) {
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = id;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

function getViewOptions(view: ViewId): ViewOptions {
  const configuration = vscode.workspace.getConfiguration(`obsidify.${view}`);
  const mode = configuration.get<ViewMode>('viewMode', 'list');
  const sortOrder = configuration.get<SortOrder>('sortOrder', 'nameAsc');
  return {
    mode: mode === 'tree' ? 'tree' : 'list',
    sortOrder: ['nameAsc', 'nameDesc', 'pathAsc', 'linkOrder'].includes(sortOrder) ? sortOrder : 'nameAsc'
  };
}

async function migrateLegacyConfiguration(): Promise<void> {
  const legacyConfiguration = vscode.workspace.getConfiguration('obsidianfy');
  const currentConfiguration = vscode.workspace.getConfiguration('obsidify');
  const settings = [
    'vaultPath',
    'viewMode',
    'sortOrder',
    'backlinks.viewMode',
    'backlinks.sortOrder',
    'outgoingLinks.viewMode',
    'outgoingLinks.sortOrder',
    'bookmarks.viewMode',
    'bookmarks.sortOrder'
  ];
  const scopes = [
    { target: vscode.ConfigurationTarget.Global, property: 'globalValue' },
    { target: vscode.ConfigurationTarget.Workspace, property: 'workspaceValue' }
  ] as const;

  for (const key of settings) {
    const previous = legacyConfiguration.inspect<unknown>(key);
    const current = currentConfiguration.inspect<unknown>(key);
    if (!previous) {
      continue;
    }

    for (const scope of scopes) {
      const previousValue = previous[scope.property];
      const currentValue = current?.[scope.property];
      if (previousValue !== undefined && currentValue === undefined) {
        await currentConfiguration.update(key, previousValue, scope.target);
      }
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const oldFolderConfiguration = vscode.workspace.getConfiguration('obsidianfy', folder.uri);
      const newFolderConfiguration = vscode.workspace.getConfiguration('obsidify', folder.uri);
      const oldValue = oldFolderConfiguration.inspect<unknown>(key)?.workspaceFolderValue;
      const newValue = newFolderConfiguration.inspect<unknown>(key)?.workspaceFolderValue;
      if (oldValue !== undefined && newValue === undefined) {
        await newFolderConfiguration.update(key, oldValue, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
  }
}

const LEGACY_COMMAND_NAMES = [
  'configureVault',
  'refresh',
  'insertLink',
  'openTarget',
  'createTarget',
  'openAtLocation',
  'toggleBookmark',
  'addActiveBookmark',
  'renameBookmark',
  'removeBookmark',
  'openBookmark',
  'toggleBacklinksViewMode',
  'toggleOutgoingViewMode',
  'toggleBookmarksViewMode',
  'toggleBacklinksExpandCollapseAll',
  'toggleOutgoingExpandCollapseAll',
  'toggleBookmarksExpandCollapseAll',
  'changeBacklinksSortOrder',
  'changeOutgoingSortOrder',
  'changeBookmarksSortOrder',
  'openSettings'
] as const;

function registerLegacyCommandAliases(): vscode.Disposable[] {
  return LEGACY_COMMAND_NAMES.map((name) =>
    vscode.commands.registerCommand(`obsidianfy.${name}`, (...args: unknown[]) =>
      vscode.commands.executeCommand(`obsidify.${name}`, ...args)
    )
  );
}

async function syncViewContexts(): Promise<void> {
  for (const view of ['backlinks', 'outgoingLinks', 'bookmarks'] satisfies ViewId[]) {
    await vscode.commands.executeCommand('setContext', `obsidify.${view}TreeMode`, getViewOptions(view).mode === 'tree');
  }
}

async function migrateLegacyViewOptions(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('obsidify');
  const scopes = [
    { target: vscode.ConfigurationTarget.Global, read: (value: { globalValue?: string }) => value.globalValue },
    { target: vscode.ConfigurationTarget.Workspace, read: (value: { workspaceValue?: string }) => value.workspaceValue }
  ];
  const settings: Array<{ legacy: string; suffix: string; allowed: readonly string[] }> = [
    { legacy: 'viewMode', suffix: 'viewMode', allowed: ['list', 'tree'] },
    { legacy: 'sortOrder', suffix: 'sortOrder', allowed: ['nameAsc', 'nameDesc', 'pathAsc', 'linkOrder'] }
  ];

  for (const setting of settings) {
    const previous = configuration.inspect<string>(setting.legacy);
    if (!previous) {
      continue;
    }
    for (const scope of scopes) {
      const value = scope.read(previous);
      if (value === undefined || !setting.allowed.includes(value)) {
        continue;
      }
      for (const view of ['backlinks', 'outgoingLinks'] satisfies LegacyViewId[]) {
        const key = `${view}.${setting.suffix}`;
        const current = configuration.inspect<string>(key);
        const hasValueAtScope = scope.target === vscode.ConfigurationTarget.Global
          ? current?.globalValue !== undefined
          : current?.workspaceValue !== undefined;
        if (!hasValueAtScope) {
          await configuration.update(key, value, scope.target);
        }
      }
    }
  }
}

function buildRows(rows: ViewRow[], options: ViewOptions, expandedAll: boolean, folderGeneration: number): vscode.TreeItem[] {
  const sorted = [...rows].sort((left, right) => compareRows(left, right, options.sortOrder));
  if (options.mode === 'list') {
    return sorted.map((row) => row.item);
  }

  interface MutableFolder {
    folders: Map<string, MutableFolder>;
    rows: ViewRow[];
    order?: string;
  }

  const root: MutableFolder = { folders: new Map(), rows: [] };
  for (const row of sorted) {
    let current = root;
    for (const segment of row.folderPath.split('/').filter(Boolean)) {
      let folder = current.folders.get(segment);
      if (!folder) {
        folder = { folders: new Map(), rows: [] };
        current.folders.set(segment, folder);
      }
      current = folder;
      if (row.folderOrder !== undefined && (current.order === undefined || row.folderOrder < current.order)) {
        current.order = row.folderOrder;
      }
    }
    current.rows.push(row);
  }

  const materialize = (folder: MutableFolder, parentPath = ''): vscode.TreeItem[] => {
    const folders = [...folder.folders.entries()].sort(([leftName, left], [rightName, right]) => {
      if (options.sortOrder === 'linkOrder' && left.order !== undefined && right.order !== undefined) {
        return compareLabels(left.order, right.order, 'linkOrder') || compareLabels(leftName, rightName, 'nameAsc');
      }
      return compareLabels(leftName, rightName, options.sortOrder);
    });
    return [
      ...folders.map(([name, child]) => {
        const folderPath = parentPath ? `${parentPath}/${name}` : name;
        const id = `obsidify-folder:${folderGeneration}:${folderPath}`;
        return new FolderTreeItem(name, materialize(child, folderPath), expandedAll, id);
      }),
      ...folder.rows.sort((left, right) => compareRows(left, right, options.sortOrder)).map((row) => row.item)
    ];
  };

  return materialize(root);
}

function compareRows(left: ViewRow, right: ViewRow, order: SortOrder): number {
  switch (order) {
    case 'nameDesc':
      return compareLabels(left.name, right.name, order) || compareLabels(left.sortPath, right.sortPath, 'pathAsc');
    case 'pathAsc':
      return compareLabels(left.sortPath, right.sortPath, order) || compareLabels(left.name, right.name, 'nameAsc');
    case 'linkOrder':
      return compareLabels(left.order, right.order, order);
    case 'nameAsc':
    default:
      return compareLabels(left.name, right.name, order) || compareLabels(left.sortPath, right.sortPath, 'pathAsc');
  }
}

function compareLabels(left: string, right: string, order: SortOrder): number {
  const result = left.localeCompare(right, 'pt-BR', { sensitivity: 'base', numeric: true });
  return order === 'nameDesc' ? -result : result;
}

class WikilinkDocumentProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly vault: VaultService) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const sourcePath = this.vault.relativePath(document.uri);
    if (!sourcePath || document.languageId !== 'markdown') {
      return [];
    }

    return parseWikilinks(document.getText()).map((link) => {
      const resolution = this.vault.resolveTarget(sourcePath, link.target);
      const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.start + link.length));
      const documentLink = new vscode.DocumentLink(range);
      const args: LinkCommandArguments = { target: link.target, sourcePath };

      if (resolution.status === 'resolved' && resolution.targetPath) {
        documentLink.target = vscode.Uri.file(path.join(this.vault.root!, ...resolution.targetPath.split('/')));
        documentLink.tooltip = `Open ${resolution.targetPath}`;
      } else if (resolution.status === 'ambiguous') {
        documentLink.target = commandUri('obsidify.openTarget', args);
        documentLink.tooltip = `Choose a destination for “${link.target}”`;
      } else {
        documentLink.target = commandUri('obsidify.createTarget', args);
        documentLink.tooltip = `Create the missing note “${link.target}”`;
      }

      return documentLink;
    });
  }
}

class WikilinkCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly vault: VaultService) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (document.languageId !== 'markdown' || !this.vault.relativePath(document.uri)) {
      return [];
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const opening = /\[\[([^\]]*)$/.exec(linePrefix);
    if (!opening || opening[1].includes('|')) {
      return [];
    }

    const query = opening[1].trim().toLocaleLowerCase();
    const insertStart = position.character - opening[1].length;
    const replaceRange = new vscode.Range(position.line, insertStart, position.line, position.character);
    const nextText = document.lineAt(position.line).text.slice(position.character, position.character + 2);
    const closing = nextText === ']]' ? '' : ']]';

    return this.vault.allFiles
      .filter((file) => {
        const linkText = this.vault.linkTextForFile(file).toLocaleLowerCase();
        const display = path.posix.basename(file).toLocaleLowerCase();
        return !query || linkText.includes(query) || display.includes(query);
      })
      .slice(0, 150)
      .map((file) => {
        const item = new vscode.CompletionItem(path.posix.basename(file), vscode.CompletionItemKind.File);
        const linkText = this.vault.linkTextForFile(file);
        item.detail = file;
        item.insertText = `${linkText}${closing}`;
        item.range = replaceRange;
        item.filterText = `${path.posix.basename(file)} ${file}`;
        return item;
      });
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await migrateLegacyConfiguration();
  await migrateLegacyViewOptions();
  await syncViewContexts();
  const legacyStoragePath = path.join(path.dirname(context.globalStorageUri.fsPath), 'andersonbosa.obsidianfy');
  const vault = new VaultService(context.globalStorageUri.fsPath, legacyStoragePath);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'obsidify.configureVault';
  status.tooltip = 'Choose the folder Obsidify indexes as your vault';
  status.show();

  let watcher: vscode.FileSystemWatcher | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let viewRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let backlinks: BacklinksProvider;
  let outgoing: OutgoingLinksProvider;
  let bookmarks: BookmarksProvider;

  const updateStatus = async (): Promise<void> => {
    const configuration = vscode.workspace.getConfiguration('obsidify');
    const configuredPath = configuration.get<string>('vaultPath', '').trim();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const root = configuredPath || workspacePath;
    let validRoot = root && path.isAbsolute(root) ? root : undefined;

    if (watcher) {
      watcher.dispose();
      watcher = undefined;
    }

    if (validRoot) {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(validRoot));
        if ((stat.type & vscode.FileType.Directory) === 0) {
          validRoot = undefined;
        }
      } catch {
        validRoot = undefined;
      }
    }

    await vault.setRoot(validRoot);

    await vscode.commands.executeCommand('setContext', 'obsidify.vaultReady', Boolean(vault.root));
    if (!vault.root) {
      status.text = '$(book) Obsidify: choose vault';
      refreshViews();
      return;
    }

    status.text = `$(book) ${path.basename(vault.root)}`;
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(vault.root), '**/*'));
    watcher.onDidCreate(scheduleRefresh, undefined, context.subscriptions);
    watcher.onDidDelete(scheduleRefresh, undefined, context.subscriptions);
    watcher.onDidChange(scheduleRefresh, undefined, context.subscriptions);
    await refreshIndex();
  };

  const refreshViews = (): void => {
    if (viewRefreshTimer) {
      clearTimeout(viewRefreshTimer);
    }
    viewRefreshTimer = setTimeout(() => {
      backlinks.refresh();
      outgoing.refresh();
      bookmarks.refresh();
    }, 60);
  };

  const refreshIndex = async (): Promise<void> => {
    await vault.refresh();
    refreshViews();
  };

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => void refreshIndex(), 250);
  };

  backlinks = new BacklinksProvider(vault, () => vscode.window.activeTextEditor);
  outgoing = new OutgoingLinksProvider(vault, () => vscode.window.activeTextEditor);
  bookmarks = new BookmarksProvider(vault);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('obsidify.backlinks', backlinks),
    vscode.window.registerTreeDataProvider('obsidify.outgoingLinks', outgoing),
    vscode.window.registerTreeDataProvider('obsidify.bookmarks', bookmarks),
    vscode.languages.registerDocumentLinkProvider({ language: 'markdown', scheme: 'file' }, new WikilinkDocumentProvider(vault)),
    vscode.languages.registerCompletionItemProvider({ language: 'markdown', scheme: 'file' }, new WikilinkCompletionProvider(vault), '['),
    status,
    vault
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('obsidify.configureVault', async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Use as Vault'
      });
      if (!folders?.[0]) {
        return;
      }
      await vscode.workspace.getConfiguration('obsidify').update('vaultPath', folders[0].fsPath, vscode.ConfigurationTarget.Global);
      await updateStatus();
      void vscode.window.showInformationMessage(`Obsidify is indexing ${folders[0].fsPath}`);
    }),
    vscode.commands.registerCommand('obsidify.refresh', () => refreshIndex()),
    vscode.commands.registerCommand('obsidify.toggleBacklinksViewMode', () => toggleViewMode('backlinks', () => backlinks.refresh())),
    vscode.commands.registerCommand('obsidify.toggleOutgoingViewMode', () => toggleViewMode('outgoingLinks', () => outgoing.refresh())),
    vscode.commands.registerCommand('obsidify.toggleBookmarksViewMode', () => toggleViewMode('bookmarks', () => bookmarks.refresh())),
    vscode.commands.registerCommand('obsidify.changeBacklinksSortOrder', () => changeSortOrder('backlinks', () => backlinks.refresh())),
    vscode.commands.registerCommand('obsidify.changeOutgoingSortOrder', () => changeSortOrder('outgoingLinks', () => outgoing.refresh())),
    vscode.commands.registerCommand('obsidify.changeBookmarksSortOrder', () => changeSortOrder('bookmarks', () => bookmarks.refresh())),
    vscode.commands.registerCommand('obsidify.toggleBacklinksExpandCollapseAll', () => toggleAllExpanded(backlinks)),
    vscode.commands.registerCommand('obsidify.toggleOutgoingExpandCollapseAll', () => toggleAllExpanded(outgoing)),
    vscode.commands.registerCommand('obsidify.toggleBookmarksExpandCollapseAll', () => toggleAllExpanded(bookmarks)),
    vscode.commands.registerCommand('obsidify.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:andersonbosa.obsidify')
    ),
    vscode.commands.registerCommand('obsidify.insertLink', () => insertWikilink(vault)),
    vscode.commands.registerCommand('obsidify.openTarget', (args: LinkCommandArguments) => openTarget(vault, args)),
    vscode.commands.registerCommand('obsidify.createTarget', (args: LinkCommandArguments) => createTarget(vault, args)),
    vscode.commands.registerCommand('obsidify.openAtLocation', (sourcePath: string, line: number) => openAtLocation(vault, sourcePath, line)),
    vscode.commands.registerCommand('obsidify.toggleBookmark', (uri?: vscode.Uri) => toggleBookmark(vault, bookmarks, uri, refreshIndex)),
    vscode.commands.registerCommand('obsidify.addActiveBookmark', () => addActiveBookmark(vault, bookmarks, refreshIndex)),
    vscode.commands.registerCommand('obsidify.renameBookmark', (item?: BookmarkTreeItem) => renameBookmark(vault, bookmarks, item)),
    vscode.commands.registerCommand('obsidify.removeBookmark', (item?: BookmarkTreeItem) => removeBookmark(vault, bookmarks, item)),
    vscode.commands.registerCommand('obsidify.openBookmark', (relativePath: string) => openBookmark(vault, relativePath)),
    ...registerLegacyCommandAliases(),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('obsidify.vaultPath')) {
        void updateStatus();
      }
      if (event.affectsConfiguration('obsidify.backlinks')) {
        backlinks.refresh();
        void vscode.commands.executeCommand('setContext', 'obsidify.backlinksTreeMode', getViewOptions('backlinks').mode === 'tree');
      }
      if (event.affectsConfiguration('obsidify.outgoingLinks')) {
        outgoing.refresh();
        void vscode.commands.executeCommand('setContext', 'obsidify.outgoingLinksTreeMode', getViewOptions('outgoingLinks').mode === 'tree');
      }
      if (event.affectsConfiguration('obsidify.bookmarks')) {
        bookmarks.refresh();
        void vscode.commands.executeCommand('setContext', 'obsidify.bookmarksTreeMode', getViewOptions('bookmarks').mode === 'tree');
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (vault.relativePath(document.uri)) {
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vault.relativePath(event.document.uri)) {
        scheduleRefresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(refreshViews)
  );

  await updateStatus();

}

async function insertWikilink(vault: VaultService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const items = vault.allFiles.map((file) => ({
    label: path.posix.basename(file),
    description: file,
    file,
    linkText: vault.linkTextForFile(file)
  }));
  const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a file in the vault to link to' });
  if (!selected) {
    return;
  }

  await editor.insertSnippet(new vscode.SnippetString(`[[${selected.linkText}]]`));
}

async function toggleViewMode(view: ViewId, refresh: () => void): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(`obsidify.${view}`);
  const current = configuration.get<ViewMode>('viewMode', 'list');
  await configuration.update('viewMode', current === 'tree' ? 'list' : 'tree', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('setContext', `obsidify.${view}TreeMode`, current !== 'tree');
  refresh();
}

function toggleAllExpanded(provider: BacklinksProvider | OutgoingLinksProvider | BookmarksProvider): void {
  provider.toggleExpandedAll();
}

async function changeSortOrder(view: ViewId, refresh: () => void): Promise<void> {
  const options: Array<vscode.QuickPickItem & { value: SortOrder }> = [
    { label: 'Name (A–Z)', value: 'nameAsc' },
    { label: 'Name (Z–A)', value: 'nameDesc' },
    { label: 'Path (A–Z)', value: 'pathAsc' },
    {
      label: 'Link order',
      value: 'linkOrder',
      description: view === 'bookmarks' ? 'Order in which files were bookmarked' : 'Order in the note or vault'
    }
  ];
  const current = getViewOptions(view).sortOrder;
  const selected = await vscode.window.showQuickPick(
    options.map((option) => ({ ...option, description: option.value === current ? 'Current' : option.description })),
    { placeHolder: `Sort ${view === 'backlinks' ? 'backlinks' : view === 'outgoingLinks' ? 'outgoing links' : 'bookmarks'}` }
  );
  if (!selected) {
    return;
  }

  await vscode.workspace.getConfiguration(`obsidify.${view}`).update('sortOrder', selected.value, vscode.ConfigurationTarget.Global);
  refresh();
}

async function toggleBookmark(
  vault: VaultService,
  provider: BookmarksProvider,
  sourceUri: vscode.Uri | undefined,
  refreshIndex: () => Promise<void>
): Promise<void> {
  const uri = sourceUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showWarningMessage('Open a file in the vault or choose a file in the Explorer to bookmark it.');
    return;
  }

  const relativePath = vault.relativePath(uri);
  if (!relativePath) {
    void vscode.window.showWarningMessage('Only files inside the configured vault can be bookmarked.');
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) {
      void vscode.window.showWarningMessage('Only files can be bookmarked.');
      return;
    }
  } catch {
    void vscode.window.showWarningMessage('Obsidify could not find that file in the vault.');
    return;
  }

  const wasIndexed = vault.allFiles.includes(relativePath);
  vault.toggleBookmark(relativePath);
  provider.refresh();
  if (!wasIndexed) {
    await refreshIndex();
  }
}

async function addActiveBookmark(
  vault: VaultService,
  provider: BookmarksProvider,
  refreshIndex: () => Promise<void>
): Promise<void> {
  const uri = getActiveFileUri();
  if (!uri) {
    void vscode.window.showWarningMessage('Open a file in the editor to add it to Bookmarks.');
    return;
  }

  const relativePath = vault.relativePath(uri);
  if (!relativePath) {
    void vscode.window.showWarningMessage('Only files inside the configured vault can be bookmarked.');
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) {
      void vscode.window.showWarningMessage('Only files can be bookmarked.');
      return;
    }
  } catch {
    void vscode.window.showWarningMessage('Obsidify could not find that file in the vault.');
    return;
  }

  const wasIndexed = vault.allFiles.includes(relativePath);
  if (vault.addBookmark(relativePath)) {
    provider.refresh();
  }
  if (!wasIndexed) {
    await refreshIndex();
  }
}

function getActiveFileUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
    return input.modified;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

async function renameBookmark(vault: VaultService, provider: BookmarksProvider, item?: BookmarkTreeItem): Promise<void> {
  if (!item?.bookmarkPath) {
    return;
  }

  const bookmark = vault.getBookmarks().find(({ path: bookmarkPath }) => bookmarkPath === item.bookmarkPath);
  if (!bookmark) {
    return;
  }

  const fileName = path.posix.basename(bookmark.path);
  const label = await vscode.window.showInputBox({
    title: 'Rename Bookmark',
    prompt: 'Set a display name for this bookmark. Leave empty to use the file name.',
    placeHolder: fileName,
    value: bookmark.label ?? fileName
  });
  if (label === undefined) {
    return;
  }

  if (vault.setBookmarkLabel(bookmark.path, label)) {
    provider.refresh();
  }
}

function removeBookmark(vault: VaultService, provider: BookmarksProvider, item?: BookmarkTreeItem): void {
  if (item?.bookmarkPath && vault.removeBookmark(item.bookmarkPath)) {
    provider.refresh();
  }
}

async function openBookmark(vault: VaultService, relativePath: string): Promise<void> {
  if (!vault.root) {
    return;
  }
  const uri = vscode.Uri.file(path.resolve(vault.root, ...relativePath.split('/')));
  if (!vault.relativePath(uri)) {
    void vscode.window.showWarningMessage('This bookmark is outside the configured vault.');
    return;
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) {
      void vscode.window.showWarningMessage(`This bookmark is unavailable: ${relativePath}`);
      return;
    }
  } catch {
    void vscode.window.showWarningMessage(`This bookmark is unavailable: ${relativePath}`);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri);
}

async function openTarget(vault: VaultService, args: LinkCommandArguments): Promise<void> {
  const resolution = vault.resolveTarget(args.sourcePath, args.target);
  let targetPath = resolution.targetPath;

  if (resolution.status === 'ambiguous') {
    const options = resolution.candidates.map((file) => ({ label: path.posix.basename(file), description: file, file }));
    targetPath = (await vscode.window.showQuickPick(options, { placeHolder: `Choose a destination for “${args.target}”` }))?.file;
  }

  if (targetPath) {
    await openFile(vault, targetPath);
    return;
  }

  if (resolution.status === 'missing') {
    await createTarget(vault, args);
  }
}

async function createTarget(vault: VaultService, args: LinkCommandArguments): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Mark this workspace as trusted to create notes from wikilinks.');
    return;
  }

  const confirmation = await vscode.window.showInformationMessage(
    `Create a Markdown note for “${args.target}”?`,
    'Create Note'
  );
  if (confirmation !== 'Create Note') {
    return;
  }

  try {
    const uri = await vault.createMarkdownNote(args.target);
    if (uri) {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } else {
      void vscode.window.showWarningMessage(`Obsidify could not create a Markdown note for “${args.target}”.`);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not create the note: ${String(error)}`);
  }
}

async function openAtLocation(vault: VaultService, sourcePath: string, line: number): Promise<void> {
  if (!vault.root) {
    return;
  }
  const uri = vscode.Uri.file(path.join(vault.root, ...sourcePath.split('/')));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const position = new vscode.Position(Math.min(line, Math.max(document.lineCount - 1, 0)), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function openFile(vault: VaultService, relativePath: string): Promise<void> {
  if (!vault.root) {
    return;
  }
  const uri = vscode.Uri.file(path.join(vault.root, ...relativePath.split('/')));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
}

function commandUri(command: string, args: unknown): vscode.Uri {
  const query = encodeURIComponent(JSON.stringify([args]));
  return vscode.Uri.parse(`command:${command}?${query}`);
}

function infoItem(message: string): vscode.TreeItem {
  const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('info');
  return item;
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function deactivate(): void {
  // Resources registered through the extension context are disposed by VS Code.
}
