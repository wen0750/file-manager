const { getDatabase } = require('../db/database');

/**
 * Quota accounting is the single source of truth for a user's storage usage.
 *
 * `used_bytes` is maintained as a counter that is adjusted incrementally on
 * managed writes (O(1)) and re-derived from the database on reconciliation
 * (no filesystem walk). Files created outside the application are folded into
 * this counter by the file watcher and the daily reconcile job.
 */

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
 * Adjust a user's used storage by a delta (O(1)).
 * The update is executed in SQL so concurrent adjustments cannot lose writes.
 *
 * @param {number} userId - User ID
 * @param {number} deltaBytes - Signed byte delta (positive to add, negative to subtract)
 * @returns {Promise<void>}
 */
async function adjustUsedStorage(userId, deltaBytes) {
    const delta = Math.trunc(Number(deltaBytes) || 0);
    if (!userId || delta === 0) return;

    const db = getDatabase();
    await db.execute(
        'UPDATE users SET used_bytes = GREATEST(0, used_bytes + ?) WHERE id = ?',
        [delta, userId]
    );
}

/**
 * Recalculate a user's used storage from file metadata (indexed aggregate).
 * Used as the authoritative reconcile step and as the safe fallback after
 * bulk operations. Does not touch the filesystem.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number>} Used storage in bytes
 */
async function recalculateStorage(userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT COALESCE(SUM(size), 0) AS used FROM file_metadata WHERE owner_id = ?',
        [userId]
    );
    const used = Number(rows[0]?.used || 0);
    await db.execute('UPDATE users SET used_bytes = ? WHERE id = ?', [used, userId]);
    return used;
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

// Backward-compatible alias — callers previously triggered a full filesystem
// walk here; it now reconciles from the database instead.
const updateUsedStorage = recalculateStorage;

module.exports = {
    getQuotaInfo,
    checkQuota,
    adjustUsedStorage,
    recalculateStorage,
    setQuota,
    updateUsedStorage
};
