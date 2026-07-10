const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');
const quotaService = require('../services/quota.service');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/users
 * List all users (admin only).
 */
router.get('/', requireAdmin, (req, res) => {
    try {
        const users = userService.getAllUsers();
        res.json({ users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/users
 * Create a new user (admin only).
 */
router.post('/', requireAdmin, (req, res) => {
    const { username, password, email, role, quotaBytes, language } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const user = userService.createUser(
            username,
            password,
            email,
            role || 'user',
            quotaBytes || null,
            language || 'en'
        );
        res.json({ success: true, user });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * PUT /api/users/:id
 * Update a user.
 */
router.put('/:id', (req, res) => {
    const targetId = parseInt(req.params.id);
    const userId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    // Users can only update themselves unless admin
    if (targetId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Only admins can change roles
    const updates = { ...req.body };
    if (!isAdmin) {
        delete updates.role;
        delete updates.quota_bytes;
        delete updates.is_active;
    }

    try {
        const user = userService.updateUser(targetId, updates);
        res.json({ success: true, user });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * DELETE /api/users/:id
 * Delete a user (admin only).
 */
router.delete('/:id', requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);

    if (targetId === req.session.userId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    try {
        userService.deleteUser(targetId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * GET /api/users/:id/quota
 * Get user's quota info.
 */
router.get('/:id/quota', (req, res) => {
    const targetId = parseInt(req.params.id);
    const userId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    if (targetId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const quota = quotaService.getQuotaInfo(targetId);
        res.json(quota);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/users/:id/permissions
 * Get user's folder permissions.
 */
router.get('/:id/permissions', requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    try {
        const perms = userService.getUserPermissions(targetId);
        res.json({ permissions: perms });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/users/:id/permissions
 * Set folder permission for a user.
 */
router.post('/:id/permissions', requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    const { folderId, permission } = req.body;

    if (!folderId || !permission) {
        return res.status(400).json({ error: 'folderId and permission are required' });
    }

    try {
        userService.setFolderPermission(parseInt(folderId), targetId, permission);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/users/:id/permissions/:folderId
 * Remove folder permission.
 */
router.delete('/:id/permissions/:folderId', requireAdmin, (req, res) => {
    const targetId = parseInt(req.params.id);
    const folderId = parseInt(req.params.folderId);

    try {
        userService.removeFolderPermission(folderId, targetId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
