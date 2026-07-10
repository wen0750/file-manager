const { getDatabase } = require('../db/database');
const { getDirectorySize } = require('../utils/helpers');

/**
 * Check if user has enough quota for the given file size.
 *
 * @param {number} userId - User ID
 * @param {number} additionalBytes - Bytes to add
 * @returns {Promise<boolean>} True if user has enough quota
 */
async function checkQuota(userId, additionalBytes) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT quota_bytes, used_bytes FROM users WHERE id = ?',
        [userId]
    );
    const user = rows[0];
    if (!user) return false;
    return (user.used_bytes + additionalBytes) <= user.quota_bytes;
}

/**
 * Update user's used storage after file operations.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number>} Used storage in bytes
 */
async function updateUsedStorage(userId) {
    const db = getDatabase();

    // Get user's root folder path
    const [rows] = await db.execute(
        'SELECT path FROM folders WHERE owner_id = ? AND parent_id IS NULL',
        [userId]
    );
    const folder = rows[0];
    if (!folder) {
        await db.execute('UPDATE users SET used_bytes = 0 WHERE id = ?', [userId]);
        return 0;
    }

    const size = getDirectorySize(folder.path);
    await db.execute('UPDATE users SET used_bytes = ? WHERE id = ?', [size, userId]);
    return size;
}

/**
 * Middleware to check quota before upload.
 */
async function quotaMiddleware(req, res, next) {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const totalSize = (req.files || []).reduce((sum, f) => sum + f.size, 0) +
                          (req.file ? req.file.size : 0);

        if (!await checkQuota(req.session.userId, totalSize)) {
            return res.status(413).json({
                error: 'Quota exceeded',
                code: 'QUOTA_EXCEEDED',
                message: 'You do not have enough storage space for this upload.'
            });
        }

        next();
    } catch (err) {
        next(err);
    }
}

module.exports = {
    checkQuota,
    updateUsedStorage,
    quotaMiddleware
};
