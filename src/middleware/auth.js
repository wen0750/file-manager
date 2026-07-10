const { getDatabase } = require('../db/database');

/**
 * Require authentication. Redirects to login if not authenticated.
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    }
    return res.redirect('/login');
}

/**
 * Require admin role.
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.userId && req.session.role === 'admin') {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Forbidden', code: 'ADMIN_REQUIRED' });
    }
    return res.status(403).send('403 Forbidden');
}

/**
 * Load current user data into req.user.
 * Async because it queries the database.
 */
async function loadUser(req, res, next) {
    try {
        if (req.session && req.session.userId) {
            const db = getDatabase();
            const [rows] = await db.execute(
                'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active FROM users WHERE id = ?',
                [req.session.userId]
            );
            const user = rows[0];

            if (user && user.is_active) {
                req.user = user;
                res.locals.user = user;
                res.locals.lang = user.language || 'en';
            } else if (user && !user.is_active) {
                // User is deactivated, destroy session
                req.session.destroy(() => {});
            }
        }
        next();
    } catch (err) {
        next(err);
    }
}

/**
 * Check folder access permission for the current user.
 * Returns 'admin', 'write', 'read', or null.
 * Recursive: inherits permissions from parent folders.
 *
 * @param {number} userId - User ID
 * @param {number} folderId - Folder ID
 * @returns {Promise<string|null>} Permission level or null
 */
async function checkFolderPermission(userId, folderId) {
    const db = getDatabase();

    // Get the folder
    const [folderRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [folderId]);
    const folder = folderRows[0];
    if (!folder) return null;

    // Owner has full access
    if (folder.owner_id === userId) return 'admin';

    // Check explicit permission
    const [permRows] = await db.execute(
        'SELECT permission FROM folder_permissions WHERE folder_id = ? AND user_id = ?',
        [folderId, userId]
    );
    const perm = permRows[0];

    if (perm) return perm.permission;

    // Check parent folder permissions (inherit)
    if (folder.parent_id) {
        return checkFolderPermission(userId, folder.parent_id);
    }

    // Admin users have access to everything
    const [userRows] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
    if (user && user.role === 'admin') return 'admin';

    return null;
}

/**
 * Check if user can write to a folder.
 *
 * @param {number} userId - User ID
 * @param {number} folderId - Folder ID
 * @returns {Promise<boolean>} True if user has write or admin permission
 */
async function canWrite(userId, folderId) {
    const perm = await checkFolderPermission(userId, folderId);
    return perm === 'write' || perm === 'admin';
}

/**
 * Check if user can read a folder.
 *
 * @param {number} userId - User ID
 * @param {number} folderId - Folder ID
 * @returns {Promise<boolean>} True if user has any permission
 */
async function canRead(userId, folderId) {
    const perm = await checkFolderPermission(userId, folderId);
    return perm !== null;
}

module.exports = {
    requireAuth,
    requireAdmin,
    loadUser,
    checkFolderPermission,
    canWrite,
    canRead
};
