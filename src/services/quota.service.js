const { getDatabase } = require('../db/database');
const { getDirectorySize } = require('../utils/helpers');

/**
 * Get user's quota info.
 */
function getQuotaInfo(userId) {
    const db = getDatabase();
    const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(userId);
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
 */
function recalculateStorage(userId) {
    return updateUsedStorage(userId);
}

/**
 * Set user quota.
 */
function setQuota(userId, quotaBytes) {
    const db = getDatabase();
    db.prepare('UPDATE users SET quota_bytes = ?, updated_at = datetime(\'now\') WHERE id = ?').run(quotaBytes, userId);
    return getQuotaInfo(userId);
}

function updateUsedStorage(userId) {
    const db = getDatabase();
    const folder = db.prepare('SELECT path FROM folders WHERE owner_id = ? AND parent_id IS NULL').get(userId);
    if (!folder) {
        db.prepare('UPDATE users SET used_bytes = 0 WHERE id = ?').run(userId);
        return 0;
    }
    const size = getDirectorySize(folder.path);
    db.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(size, userId);
    return size;
}

module.exports = {
    getQuotaInfo,
    recalculateStorage,
    setQuota,
    updateUsedStorage
};
