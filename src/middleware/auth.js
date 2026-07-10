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
 */
function loadUser(req, res, next) {
    if (req.session && req.session.userId) {
        const db = getDatabase();
        const user = db.prepare(
            'SELECT id, username, email, role, quota_bytes, used_bytes, language, is_active FROM users WHERE id = ?'
        ).get(req.session.userId);

        if (user && user.is_active) {
            req.user = user;
            res.locals.user = user;
            res.locals.lang = user.language || 'en';
        } else if (user && !user.is_active) {
            // User is deactivated, destroy session
            req.session.destroy();
        }
    }
    next();
}

/**
 * Check folder access permission for the current user.
 * Returns 'admin', 'write', 'read', or null.
 */
function checkFolderPermission(userId, folderId) {
    const db = getDatabase();

    // Get the folder and its full path chain
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
    if (!folder) return null;

    // Owner has full access
    if (folder.owner_id === userId) return 'admin';

    // Check explicit permission
    const perm = db.prepare(
        'SELECT permission FROM folder_permissions WHERE folder_id = ? AND user_id = ?'
    ).get(folderId, userId);

    if (perm) return perm.permission;

    // Check parent folder permissions (inherit)
    if (folder.parent_id) {
        return checkFolderPermission(userId, folder.parent_id);
    }

    // Admin users have access to everything
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (user && user.role === 'admin') return 'admin';

    return null;
}

/**
 * Check if user can write to a folder.
 */
function canWrite(userId, folderId) {
    const perm = checkFolderPermission(userId, folderId);
    return perm === 'write' || perm === 'admin';
}

/**
 * Check if user can read a folder.
 */
function canRead(userId, folderId) {
    const perm = checkFolderPermission(userId, folderId);
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
