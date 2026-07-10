const { getDatabase } = require('../db/database');

/**
 * Check if user has enough quota for the given file size.
 */
function checkQuota(userId, additionalBytes) {
    const db = getDatabase();
    const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(userId);
    if (!user) return false;
    return (user.used_bytes + additionalBytes) <= user.quota_bytes;
}

/**
 * Update user's used storage after file operations.
 */
function updateUsedStorage(userId) {
    const db = getDatabase();
    const { getDirectorySize } = require('../utils/helpers');

    // Get user's root folder path
    const folder = db.prepare('SELECT path FROM folders WHERE owner_id = ? AND parent_id IS NULL').get(userId);
    if (!folder) {
        db.prepare('UPDATE users SET used_bytes = 0 WHERE id = ?').run(userId);
        return 0;
    }

    const size = getDirectorySize(folder.path);
    db.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(size, userId);
    return size;
}

/**
 * Middleware to check quota before upload.
 */
function quotaMiddleware(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const totalSize = (req.files || []).reduce((sum, f) => sum + f.size, 0) +
                      (req.file ? req.file.size : 0);

    if (!checkQuota(req.session.userId, totalSize)) {
        return res.status(413).json({
            error: 'Quota exceeded',
            code: 'QUOTA_EXCEEDED',
            message: 'You do not have enough storage space for this upload.'
        });
    }

    next();
}

module.exports = {
    checkQuota,
    updateUsedStorage,
    quotaMiddleware
};
