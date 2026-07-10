const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

/**
 * Create and return the MySQL connection pool.
 * Subsequent calls return the cached pool instance.
 *
 * @returns {mysql.Pool} The MySQL connection pool
 */
function getPool() {
    if (pool) return pool;

    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'file_manager',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: 'utf8mb4',
        multipleStatements: true,
        dateStrings: true
    });

    return pool;
}

/**
 * Backward-compatible alias — returns the pool.
 * @returns {mysql.Pool}
 */
function getDatabase() {
    return getPool();
}

/**
 * Close the database connection pool.
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

/**
 * Execute the MySQL schema file to create tables and indexes.
 * Should be called once during application startup.
 */
async function initSchema() {
    const db = getPool();
    const schemaPath = path.join(__dirname, 'schema-mysql.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schema);
}

/**
 * Get a setting value by key.
 *
 * @param {string} key - Setting key
 * @param {*} defaultValue - Value to return if key not found
 * @returns {Promise<string|null>} The setting value or defaultValue
 */
async function getSetting(key, defaultValue = null) {
    const db = getPool();
    const [rows] = await db.execute(
        'SELECT value FROM settings WHERE `key` = ?',
        [key]
    );
    return rows.length > 0 ? rows[0].value : defaultValue;
}

/**
 * Set a setting value (insert or update).
 *
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 */
async function setSetting(key, value) {
    const db = getPool();
    await db.execute(
        'INSERT INTO settings (`key`, value, updated_at) VALUES (?, ?, NOW()) ' +
        'ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
        [key, value]
    );
}

module.exports = {
    getPool,
    getDatabase,
    closeDatabase,
    initSchema,
    getSetting,
    setSetting
};
