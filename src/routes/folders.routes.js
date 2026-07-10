const express = require('express');
const router = express.Router();
const folderService = require('../services/folder.service');
const { requireAuth, canWrite, canRead } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/folders?parent_id=
 * List folders, or get folder tree.
 */
router.get('/', asyncHandler(async (req, res) => {
    const userId = req.session.userId;

    if (req.query.tree === 'true') {
        const tree = await folderService.getFolderTree(userId);
        return res.json(tree);
    }

    const parentId = req.query.parent_id ? parseInt(req.query.parent_id, 10) : null;
    const items = await folderService.getFolderTree(userId, parentId);
    res.json(items);
}));

/**
 * POST /api/folders
 * Create a new folder.
 */
router.post('/', asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    const { name, parentId } = req.body;

    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    // Check write permission on parent
    if (parentId && !await canWrite(userId, parseInt(parentId, 10))) {
        return res.status(403).json({ error: 'No write permission for parent folder' });
    }

    const folder = await folderService.createFolder(name, parentId || null, userId);
    res.json({ success: true, folder });
}));

/**
 * PUT /api/folders/:id
 * Rename a folder.
 */
router.put('/:id', asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    const folderId = parseInt(req.params.id, 10);
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    await folderService.renameFolder(folderId, name, userId);
    res.json({ success: true });
}));

/**
 * DELETE /api/folders/:id
 * Delete a folder.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    const folderId = parseInt(req.params.id, 10);

    await folderService.deleteFolder(folderId, userId);
    res.json({ success: true });
}));

module.exports = router;
