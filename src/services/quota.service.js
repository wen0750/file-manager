const { getDatabase } = require('../db/database');
const { getDirectorySize } = require('../utils/helpers');

/**
 * Get user's quota info.
 *
 * @param {number} userId - User ID
 * @returns {Promise<object|null>} Quota info object
 */
async function getQuotaInfo(userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT quota_bytes, used_bytes FROM users WHERE id = ?',
        [userId]
    );
    const user = rows[0];
    if (!user) return null;

    return {
        quota: user.quota_bytes,
        used: user.used_bytes,
        available: user.quota_bytes - user.used_bytes,
        percentage: user.quota_bytes > 0 ? Math.round((user.used_bytes / user.quota_bytes) * 100) : 0
    };
}

/**
 * Recalculate user's used storage.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number>} Used storage in bytes
 */
async function recalculateStorage(userId) {
    return updateUsedStorage(userId);
}

/**
 * Set user quota.
 *
 * @param {number} userId - User ID
 * @param {number} quotaBytes - New quota in bytes
 * @returns {Promise<object>} Updated quota info
 */
async function setQuota(userId, quotaBytes) {
    const db = getDatabase();
    await db.execute(
        'UPDATE users SET quota_bytes = ?, updated_at = NOW() WHERE id = ?',
        [quotaBytes, userId]
    );
    return getQuotaInfo(userId);
}

/**
 * Update user's used storage by scanning the filesystem.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number>} Used storage in bytes
 */
async function updateUsedStorage(userId) {
    const db = getDatabase();
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

module.exports = {
    getQuotaInfo,
    recalculateStorage,
    setQuota,
    updateUsedStorage
};
