import { DatabaseSync } from 'node:sqlite';

const CURRENT_SCHEMA_VERSION = 3;

export function openIndexDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 1000;');
    let version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Obsidify index schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`);
    }

    if (version === 0) {
      database.exec(`
        CREATE TABLE vault_files (
          path TEXT PRIMARY KEY,
          mtime INTEGER NOT NULL,
          size INTEGER NOT NULL,
          needs_reindex INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE wikilinks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_path TEXT NOT NULL,
          target TEXT NOT NULL,
          alias TEXT,
          start INTEGER NOT NULL,
          length INTEGER NOT NULL,
          line INTEGER NOT NULL,
          snippet TEXT NOT NULL,
          status TEXT NOT NULL,
          target_path TEXT,
          candidates_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX wikilinks_source_idx ON wikilinks(source_path, line, start);
        CREATE INDEX wikilinks_target_idx ON wikilinks(target_path, source_path, line);
        PRAGMA user_version = 1;
      `);
      version = 1;
    }

    if (version === 1) {
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.exec(`
          CREATE TABLE bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE
          );
          PRAGMA user_version = 2;
          COMMIT;
        `);
      } catch (error) {
        try {
          database.exec('ROLLBACK;');
        } catch {
          // Keep the migration error if rollback is unavailable.
        }
        throw error;
      }
      version = 2;
    }

    if (version === 2) {
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.exec(`
          ALTER TABLE bookmarks ADD COLUMN label TEXT;
          PRAGMA user_version = 3;
          COMMIT;
        `);
      } catch (error) {
        try {
          database.exec('ROLLBACK;');
        } catch {
          // Keep the migration error if rollback is unavailable.
        }
        throw error;
      }
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
