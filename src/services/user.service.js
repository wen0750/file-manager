const bcrypt = require('bcryptjs');
const { getDatabase } = require('../db/database');
const { updateUsedStorage } = require('../middleware/quota');

/**
 * Create a new user.
 */
function createUser(username, password, email, role = 'user', quotaBytes = null, language = 'en') {
    const db = getDatabase();

    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) throw new Error('Username already exists');

    const passwordHash = bcrypt.hashSync(password, 12);
    const defaultQuota = quotaBytes || parseInt(process.env.DEFAULT_QUOTA || '10737418240');

    const result = db.prepare(
        `INSERT INTO users (username, password_hash, email, role, quota_bytes, used_bytes, language, is_active)
         VALUES (?, ?, ?, ?, ?, 0, ?, 1)`
    ).run(username, passwordHash, email || null, role, defaultQuota, language);

    const userId = result.lastInsertRowid;

    // Create root folder for the user
    const path = require('path');
    const fs = require('fs');
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    const userDir = path.join(uploadDir, String(userId));
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    db.prepare(
        `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`
    ).run(userId, userDir);

    return getUserById(userId);
}

/**
 * Get user by ID (without password).
 */
function getUserById(userId) {
    const db = getDatabase();
    return db.prepare(
        'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(userId);
}

/**
 * Get all users (admin only).
 */
function getAllUsers() {
    const db = getDatabase();
    return db.prepare(
        'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active, created_at, updated_at FROM users ORDER BY created_at DESC'
    ).all();
}

/**
 * Update user.
 */
function updateUser(userId, updates) {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const allowedFields = ['email', 'role', 'quota_bytes', 'language', 'is_active'];
    const setClauses = [];
    const params = [];

    for (const field of allowedFields) {
        if (field in updates) {
            setClauses.push(`${field} = ?`);
            params.push(updates[field]);
        }
    }

    if (updates.password) {
        setClauses.push('password_hash = ?');
        params.push(bcrypt.hashSync(updates.password, 12));
    }

    if (setClauses.length === 0) return user;

    setClauses.push(`updated_at = datetime('now')`);
    params.push(userId);

    db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    return getUserById(userId);
}

/**
 * Delete user.
 */
function deleteUser(userId) {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    if (user.role === 'admin') {
        const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1").get();
        if (adminCount.count <= 1) throw new Error('Cannot delete the last admin user');
    }

    // Delete user's files directory
    const path = require('path');
    const fs = require('fs');
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    const userDir = path.join(uploadDir, String(userId));
    if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return true;
}

/**
 * Verify password.
 */
function verifyPassword(username, password) {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user) return null;

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return null;

    // Log activity
    db.prepare(
        `INSERT INTO activity_log (user_id, action, details) VALUES (?, 'login', 'User logged in')`
    ).run(user.id);

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        language: user.language
    };
}

/**
 * Get folder permissions for a user.
 */
function getUserPermissions(userId) {
    const db = getDatabase();
    return db.prepare(
        `SELECT fp.*, f.name as folder_name, u.username as owner_name
         FROM folder_permissions fp
         JOIN folders f ON fp.folder_id = f.id
         JOIN users u ON f.owner_id = u.id
         WHERE fp.user_id = ?
         ORDER BY f.name ASC`
    ).all(userId);
}

/**
 * Set folder permission for a user.
 */
function setFolderPermission(folderId, userId, permission) {
    const db = getDatabase();
    db.prepare(
        `INSERT INTO folder_permissions (folder_id, user_id, permission)
         VALUES (?, ?, ?)
         ON CONFLICT(folder_id, user_id) DO UPDATE SET permission = excluded.permission`
    ).run(folderId, userId, permission);
    return true;
}

/**
 * Remove folder permission.
 */
function removeFolderPermission(folderId, userId) {
    const db = getDatabase();
    db.prepare('DELETE FROM folder_permissions WHERE folder_id = ? AND user_id = ?').run(folderId, userId);
    return true;
}

module.exports = {
    createUser,
    getUserById,
    getAllUsers,
    updateUser,
    deleteUser,
    verifyPassword,
    getUserPermissions,
    setFolderPermission,
    removeFolderPermission
};
