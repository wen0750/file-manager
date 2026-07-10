/**
 * Database initialization script.
 * Creates tables, default admin user, and root folders.
 * Run with: npm run init-db
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDatabase, closeDatabase, initSchema, setSetting, getSetting } = require('./database');
const path = require('path');
const fs = require('fs');

/**
 * Initialize the database: run schema, create admin user, set defaults.
 */
async function initDatabase() {
    console.log('Initializing database...');

    const db = getDatabase();

    // Run schema (create tables, indexes, default settings)
    await initSchema();
    console.log('Schema initialized.');

    // Create upload directory
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`Created upload directory: ${uploadDir}`);
    }

    // Check if admin user exists
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const [existingRows] = await db.execute(
        'SELECT id FROM users WHERE username = ?',
        [adminUsername]
    );
    const existingAdmin = existingRows[0];

    if (!existingAdmin) {
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const passwordHash = bcrypt.hashSync(adminPassword, 12);
        const defaultQuota = parseInt(process.env.DEFAULT_QUOTA || '10737418240', 10);

        const [result] = await db.execute(
            `INSERT INTO users (username, password_hash, email, role, quota_bytes, used_bytes, language, is_active)
             VALUES (?, ?, ?, 'admin', ?, 0, 'en', 1)`,
            [adminUsername, passwordHash, `${adminUsername}@localhost`, defaultQuota]
        );

        const adminId = result.insertId;

        // Create root folder for admin
        const rootDir = path.join(uploadDir, String(adminId));
        if (!fs.existsSync(rootDir)) {
            fs.mkdirSync(rootDir, { recursive: true });
        }

        await db.execute(
            `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`,
            [adminId, rootDir]
        );

        console.log(`Created admin user: ${adminUsername} (password: ${adminPassword})`);
        console.log('  >> Please change the admin password after first login!');
    } else {
        console.log('Admin user already exists, skipping.');
    }

    // Set default settings from env
    const settingsDefaults = {
        'app_name': 'File Manager',
        'default_language': 'en',
        'default_quota': process.env.DEFAULT_QUOTA || '10737418240',
        'allow_registration': '0',
        'max_file_size': process.env.MAX_FILE_SIZE || '2147483648',
        'allowed_extensions': ''
    };

    for (const [key, value] of Object.entries(settingsDefaults)) {
        const existing = await getSetting(key);
        if (existing === null) {
            await setSetting(key, value);
        }
    }

    console.log('Database initialization complete.');
}

module.exports = { initDatabase };

// Auto-run if called directly (npm run init-db)
if (require.main === module) {
    initDatabase().then(() => closeDatabase()).then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Database initialization failed:', err);
        process.exit(1);
    });
}
