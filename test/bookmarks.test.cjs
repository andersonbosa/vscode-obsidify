const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BookmarkStore } = require('../out/bookmark-store.js');
const { openIndexDatabase } = require('../out/index-database.js');

function withTemporaryDatabase(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidify-bookmarks-'));
  const databasePath = path.join(directory, 'vault.sqlite');
  try {
    run(databasePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('lists bookmarks in the order they were added without duplicate paths', () => {
  withTemporaryDatabase((databasePath) => {
    const database = openIndexDatabase(databasePath);
    try {
      const bookmarks = new BookmarkStore(database);

      assert.equal(bookmarks.toggle('Notes/Start Here.md'), true);
      assert.equal(bookmarks.toggle('Collections/Glossary.md'), true);
      assert.equal(bookmarks.has('Notes/Start Here.md'), true);
      assert.deepEqual(bookmarks.list().map(({ path: bookmarkPath }) => bookmarkPath), [
        'Notes/Start Here.md',
        'Collections/Glossary.md'
      ]);
    } finally {
      database.close();
    }
  });
});

test('removes a bookmark and allows it to be added again at the end', () => {
  withTemporaryDatabase((databasePath) => {
    const database = openIndexDatabase(databasePath);
    try {
      const bookmarks = new BookmarkStore(database);
      bookmarks.toggle('first.md');
      bookmarks.toggle('second.pdf');

      assert.equal(bookmarks.remove('first.md'), true);
      assert.equal(bookmarks.remove('first.md'), false);
      assert.equal(bookmarks.toggle('first.md'), true);
      assert.deepEqual(bookmarks.list().map(({ path: bookmarkPath }) => bookmarkPath), ['second.pdf', 'first.md']);
    } finally {
      database.close();
    }
  });
});

test('keeps bookmarks when the database is reopened', () => {
  withTemporaryDatabase((databasePath) => {
    let database = openIndexDatabase(databasePath);
    new BookmarkStore(database).toggle('Collections/Glossary.md');
    database.close();

    database = openIndexDatabase(databasePath);
    try {
      assert.equal(new BookmarkStore(database).has('Collections/Glossary.md'), true);
      assert.equal(new BookmarkStore(database).has('missing.md'), false);
    } finally {
      database.close();
    }
  });
});

test('rejects paths outside the vault', () => {
  withTemporaryDatabase((databasePath) => {
    const database = openIndexDatabase(databasePath);
    try {
      const bookmarks = new BookmarkStore(database);

      assert.throws(() => bookmarks.toggle('../outside.md'), /relative to the vault/);
      assert.throws(() => bookmarks.toggle('/outside.md'), /relative to the vault/);
      assert.throws(() => bookmarks.toggle('C:\\outside.md'), /relative to the vault/);
      assert.deepEqual(bookmarks.list(), []);
    } finally {
      database.close();
    }
  });
});

test('migrates a version 1 index without removing existing indexed files', () => {
  withTemporaryDatabase((databasePath) => {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE vault_files(path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, needs_reindex INTEGER NOT NULL DEFAULT 0);
      INSERT INTO vault_files(path, mtime, size) VALUES ('Existing Note.md', 100, 20);
      CREATE TABLE wikilinks(id INTEGER PRIMARY KEY, source_path TEXT NOT NULL, target TEXT NOT NULL);
      INSERT INTO wikilinks(id, source_path, target) VALUES (1, 'Existing Note.md', 'Another Note');
      PRAGMA user_version = 1;
    `);
    legacyDatabase.close();

    const migratedDatabase = openIndexDatabase(databasePath);
    try {
      assert.equal(migratedDatabase.prepare('PRAGMA user_version').get().user_version, 3);
      assert.equal(migratedDatabase.prepare('SELECT path FROM vault_files').get().path, 'Existing Note.md');
      assert.equal(migratedDatabase.prepare('SELECT target FROM wikilinks').get().target, 'Another Note');
      assert.deepEqual(new BookmarkStore(migratedDatabase).list(), []);
    } finally {
      migratedDatabase.close();
    }
  });
});
