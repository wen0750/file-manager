const {
    checkQuota,
    adjustUsedStorage,
    recalculateStorage,
    updateUsedStorage
} = require('../services/quota.service');

/**
 * Middleware to check quota before upload.
 * Files are already written by multer at this point, so on rejection the
 * caller is expected to clean them up.
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
    adjustUsedStorage,
    recalculateStorage,
    updateUsedStorage,
    quotaMiddleware
};
