/**
 * Database initialization script.
 * Creates tables, default admin user, and root folders.
 * Run with: npm run init-db
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDatabase, closeDatabase, setSetting, getSetting } = require('./database');
const path = require('path');
const fs = require('fs');

async function initDatabase() {
    console.log('Initializing database...');

    const db = getDatabase();

    // Create upload directory
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`Created upload directory: ${uploadDir}`);
    }

    // Check if admin user exists
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);

    if (!existingAdmin) {
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const passwordHash = bcrypt.hashSync(adminPassword, 12);
        const defaultQuota = parseInt(process.env.DEFAULT_QUOTA || '10737418240');

        const result = db.prepare(
            `INSERT INTO users (username, password_hash, email, role, quota_bytes, used_bytes, language, is_active)
             VALUES (?, ?, ?, 'admin', ?, 0, 'en', 1)`
        ).run(adminUsername, passwordHash, `${adminUsername}@localhost`, defaultQuota);

        const adminId = result.lastInsertRowid;

        // Create root folder for admin
        const rootDir = path.join(uploadDir, String(adminId));
        if (!fs.existsSync(rootDir)) {
            fs.mkdirSync(rootDir, { recursive: true });
        }

        db.prepare(
            `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`
        ).run(adminId, rootDir);

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
        const existing = getSetting(key);
        if (existing === null) {
            setSetting(key, value);
        }
    }

    console.log('Database initialization complete.');
}

module.exports = { initDatabase };

// Auto-run if called directly (npm run init-db)
if (require.main === module) {
    initDatabase().then(() => {
        closeDatabase();
        process.exit(0);
    }).catch(err => {
        console.error('Database initialization failed:', err);
        process.exit(1);
    });
}
