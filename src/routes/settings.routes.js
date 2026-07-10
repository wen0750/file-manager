const express = require('express');
const router = express.Router();
const { getSetting, setSetting, getDatabase } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/settings
 * Get all settings (admin sees all, users see public settings).
 */
router.get('/', asyncHandler(async (req, res) => {
    const settings = {};
    const publicKeys = ['app_name', 'default_language', 'allow_registration'];

    if (req.session.role === 'admin') {
        const db = getDatabase();
        const [rows] = await db.execute('SELECT `key`, value FROM settings');
        for (const row of rows) {
            settings[row.key] = row.value;
        }
    } else {
        for (const key of publicKeys) {
            settings[key] = await getSetting(key);
        }
    }

    res.json({ settings });
}));

/**
 * PUT /api/settings
 * Update settings (admin only).
 */
router.put('/', requireAdmin, asyncHandler(async (req, res) => {
    const allowedKeys = [
        'app_name',
        'default_language',
        'default_quota',
        'allow_registration',
        'max_file_size',
        'allowed_extensions'
    ];

    for (const [key, value] of Object.entries(req.body)) {
        if (allowedKeys.includes(key)) {
            await setSetting(key, String(value));
        }
    }
    res.json({ success: true });
}));

/**
 * PUT /api/settings/language
 * Update current user's language preference.
 */
router.put('/language', asyncHandler(async (req, res) => {
    const { language } = req.body;
    const supported = ['en', 'zh-HK', 'zh-CN'];

    if (!language || !supported.includes(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
    }

    const db = getDatabase();
    await db.execute(
        'UPDATE users SET language = ?, updated_at = NOW() WHERE id = ?',
        [language, req.session.userId]
    );

    req.user = req.user || {};
    req.user.language = language;
    res.locals.lang = language;

    res.json({ success: true, language });
}));

module.exports = router;
