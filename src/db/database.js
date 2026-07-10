const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

/**
 * Initialize and return the database connection.
 * Creates the data directory and runs schema if needed.
 */
function getDatabase() {
    if (db) return db;

    const dbPath = path.resolve(process.env.DB_PATH || './data/database.db');
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    return db;
}

/**
 * Close the database connection.
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Get a setting value by key.
 */
function getSetting(key, defaultValue = null) {
    const database = getDatabase();
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

/**
 * Set a setting value.
 */
function setSetting(key, value) {
    const database = getDatabase();
    database.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(key, value);
}

module.exports = {
    getDatabase,
    closeDatabase,
    getSetting,
    setSetting
};
