const bcrypt = require('bcryptjs');
const { getDatabase } = require('../db/database');
const { updateUsedStorage } = require('../middleware/quota');

/**
 * Create a new user.
 *
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @param {string|null} email - Email address
 * @param {string} role - User role ('admin' or 'user')
 * @param {number|null} quotaBytes - Storage quota in bytes
 * @param {string} language - Preferred language code
 * @returns {Promise<object>} The created user object
 */
async function createUser(username, password, email, role = 'user', quotaBytes = null, language = 'en') {
    const db = getDatabase();

    // Check if username exists
    const [existingRows] = await db.execute(
        'SELECT id FROM users WHERE username = ?',
        [username]
    );
    if (existingRows.length > 0) throw new Error('Username already exists');

    const passwordHash = bcrypt.hashSync(password, 12);
    const defaultQuota = quotaBytes || parseInt(process.env.DEFAULT_QUOTA || '10737418240', 10);

    const [result] = await db.execute(
        `INSERT INTO users (username, password_hash, email, role, quota_bytes, used_bytes, language, is_active)
         VALUES (?, ?, ?, ?, ?, 0, ?, 1)`,
        [username, passwordHash, email || null, role, defaultQuota, language]
    );

    const userId = result.insertId;

    // Create root folder for the user
    const path = require('path');
    const fs = require('fs');
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    const userDir = path.join(uploadDir, String(userId));
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    await db.execute(
        `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`,
        [userId, userDir]
    );

    return getUserById(userId);
}

/**
 * Get user by ID (without password).
 *
 * @param {number} userId - User ID
 * @returns {Promise<object|undefined>} User object
 */
async function getUserById(userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active, created_at, updated_at FROM users WHERE id = ?',
        [userId]
    );
    return rows[0];
}

/**
 * Get all users (admin only).
 *
 * @returns {Promise<object[]>} Array of user objects
 */
async function getAllUsers() {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    return rows;
}

/**
 * Update user.
 *
 * @param {number} userId - User ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated user object
 */
async function updateUser(userId, updates) {
    const db = getDatabase();
    const [userRows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
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

    setClauses.push('updated_at = NOW()');
    params.push(userId);

    await db.execute(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);

    return getUserById(userId);
}

/**
 * Delete user.
 *
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteUser(userId) {
    const db = getDatabase();
    const [userRows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
    if (!user) throw new Error('User not found');
    if (user.role === 'admin') {
        const [countRows] = await db.execute(
            "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1"
        );
        if (countRows[0].count <= 1) throw new Error('Cannot delete the last admin user');
    }

    // Delete user's files directory
    const path = require('path');
    const fs = require('fs');
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
    const userDir = path.join(uploadDir, String(userId));
    if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    return true;
}

/**
 * Verify password and return user info on success.
 *
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @returns {Promise<object|null>} User info or null
 */
async function verifyPassword(username, password) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE username = ? AND is_active = 1',
        [username]
    );
    const user = rows[0];
    if (!user) return null;

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return null;

    // Log activity
    await db.execute(
        `INSERT INTO activity_log (user_id, action, details) VALUES (?, 'login', 'User logged in')`,
        [user.id]
    );

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
 *
 * @param {number} userId - User ID
 * @returns {Promise<object[]>} Array of permission objects
 */
async function getUserPermissions(userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        `SELECT fp.*, f.name as folder_name, u.username as owner_name
         FROM folder_permissions fp
         JOIN folders f ON fp.folder_id = f.id
         JOIN users u ON f.owner_id = u.id
         WHERE fp.user_id = ?
         ORDER BY f.name ASC`,
        [userId]
    );
    return rows;
}

/**
 * Set folder permission for a user.
 *
 * @param {number} folderId - Folder ID
 * @param {number} userId - User ID
 * @param {string} permission - Permission level ('read', 'write', 'admin')
 * @returns {Promise<boolean>} True on success
 */
async function setFolderPermission(folderId, userId, permission) {
    const db = getDatabase();
    await db.execute(
        `INSERT INTO folder_permissions (folder_id, user_id, permission)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE permission = VALUES(permission)`,
        [folderId, userId, permission]
    );
    return true;
}

/**
 * Remove folder permission.
 *
 * @param {number} folderId - Folder ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True on success
 */
async function removeFolderPermission(folderId, userId) {
    const db = getDatabase();
    await db.execute(
        'DELETE FROM folder_permissions WHERE folder_id = ? AND user_id = ?',
        [folderId, userId]
    );
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
