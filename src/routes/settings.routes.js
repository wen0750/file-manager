const express = require('express');
const router = express.Router();
const { getSetting, setSetting } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/settings
 * Get all settings (admin sees all, users see public settings).
 */
router.get('/', (req, res) => {
    try {
        const settings = {};
        const publicKeys = ['app_name', 'default_language', 'allow_registration'];

        if (req.session.role === 'admin') {
            const { getDatabase } = require('../db/database');
            const db = getDatabase();
            const rows = db.prepare('SELECT key, value FROM settings').all();
            for (const row of rows) {
                settings[row.key] = row.value;
            }
        } else {
            for (const key of publicKeys) {
                settings[key] = getSetting(key);
            }
        }

        res.json({ settings });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * PUT /api/settings
 * Update settings (admin only).
 */
router.put('/', requireAdmin, (req, res) => {
    const allowedKeys = [
        'app_name',
        'default_language',
        'default_quota',
        'allow_registration',
        'max_file_size',
        'allowed_extensions'
    ];

    try {
        for (const [key, value] of Object.entries(req.body)) {
            if (allowedKeys.includes(key)) {
                setSetting(key, String(value));
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * PUT /api/settings/language
 * Update current user's language preference.
 */
router.put('/language', (req, res) => {
    const { language } = req.body;
    const supported = ['en', 'zh-HK', 'zh-CN'];

    if (!language || !supported.includes(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
    }

    try {
        const { getDatabase } = require('../db/database');
        const db = getDatabase();
        db.prepare('UPDATE users SET language = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(language, req.session.userId);

        req.user = req.user || {};
        req.user.language = language;
        res.locals.lang = language;

        res.json({ success: true, language });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
