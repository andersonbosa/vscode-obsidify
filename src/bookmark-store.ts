import { DatabaseSync } from 'node:sqlite';
import { normalizeRelativePath } from './link-resolution';

export interface BookmarkRecord {
  path: string;
  order: number;
  label?: string;
}

export class BookmarkStore {
  constructor(private readonly database: DatabaseSync) {}

  list(): BookmarkRecord[] {
    const rows = this.database.prepare('SELECT id, path, label FROM bookmarks ORDER BY id').all() as unknown as Array<{ id: number; path: string; label: string | null }>;
    return rows.map((row) => ({ path: row.path, order: row.id, label: row.label ?? undefined }));
  }

  has(relativePath: string): boolean {
    const path = normalizeBookmarkPath(relativePath);
    if (!path) {
      return false;
    }
    return Boolean(this.database.prepare('SELECT 1 FROM bookmarks WHERE path = ?').get(path));
  }

  toggle(relativePath: string): boolean {
    const path = normalizeBookmarkPath(relativePath);
    if (!path) {
      throw new Error('Bookmark paths must be relative to the vault.');
    }

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.database.prepare('SELECT 1 FROM bookmarks WHERE path = ?').get(path);
      if (existing) {
        this.database.prepare('DELETE FROM bookmarks WHERE path = ?').run(path);
        this.database.exec('COMMIT;');
        return false;
      }

      this.database.prepare('INSERT INTO bookmarks(path) VALUES (?)').run(path);
      this.database.exec('COMMIT;');
      return true;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK;');
      } catch {
        // Keep the original database error if rollback is unavailable.
      }
      throw error;
    }
  }

  add(relativePath: string): boolean {
    const path = normalizeBookmarkPath(relativePath);
    if (!path) {
      throw new Error('Bookmark paths must be relative to the vault.');
    }

    const result = this.database.prepare('INSERT OR IGNORE INTO bookmarks(path) VALUES (?)').run(path);
    return result.changes > 0;
  }

  setLabel(relativePath: string, label: string | undefined): boolean {
    const path = normalizeBookmarkPath(relativePath);
    if (!path) {
      return false;
    }

    const normalizedLabel = label?.trim() || null;
    const result = this.database.prepare('UPDATE bookmarks SET label = ? WHERE path = ?').run(normalizedLabel, path);
    return result.changes > 0;
  }

  remove(relativePath: string): boolean {
    const path = normalizeBookmarkPath(relativePath);
    if (!path) {
      return false;
    }
    const existing = this.database.prepare('SELECT 1 FROM bookmarks WHERE path = ?').get(path);
    if (!existing) {
      return false;
    }
    this.database.prepare('DELETE FROM bookmarks WHERE path = ?').run(path);
    return true;
  }
}

function normalizeBookmarkPath(value: string): string | undefined {
  if (!value || value.startsWith('/')) {
    return undefined;
  }
  const normalized = normalizeRelativePath(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  return normalized;
}
