const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');
const quotaService = require('../services/quota.service');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/users
 * List all users (admin only).
 */
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
    const users = await userService.getAllUsers();
    res.json({ users });
}));

/**
 * POST /api/users
 * Create a new user (admin only).
 */
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
    const { username, password, email, role, quotaBytes, language } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await userService.createUser(
        username,
        password,
        email,
        role || 'user',
        quotaBytes || null,
        language || 'en'
    );
    res.json({ success: true, user });
}));

/**
 * PUT /api/users/:id
 * Update a user.
 */
router.put('/:id', asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
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

    const user = await userService.updateUser(targetId, updates);
    res.json({ success: true, user });
}));

/**
 * DELETE /api/users/:id
 * Delete a user (admin only).
 */
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);

    if (targetId === req.session.userId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await userService.deleteUser(targetId);
    res.json({ success: true });
}));

/**
 * GET /api/users/:id/quota
 * Get user's quota info.
 */
router.get('/:id/quota', asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    const userId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    if (targetId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const quota = await quotaService.getQuotaInfo(targetId);
    res.json(quota);
}));

/**
 * GET /api/users/:id/permissions
 * Get user's folder permissions.
 */
router.get('/:id/permissions', requireAdmin, asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    const perms = await userService.getUserPermissions(targetId);
    res.json({ permissions: perms });
}));

/**
 * POST /api/users/:id/permissions
 * Set folder permission for a user.
 */
router.post('/:id/permissions', requireAdmin, asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    const { folderId, permission } = req.body;

    if (!folderId || !permission) {
        return res.status(400).json({ error: 'folderId and permission are required' });
    }

    await userService.setFolderPermission(parseInt(folderId, 10), targetId, permission);
    res.json({ success: true });
}));

/**
 * DELETE /api/users/:id/permissions/:folderId
 * Remove folder permission.
 */
router.delete('/:id/permissions/:folderId', requireAdmin, asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    const folderId = parseInt(req.params.folderId, 10);

    await userService.removeFolderPermission(folderId, targetId);
    res.json({ success: true });
}));

module.exports = router;
