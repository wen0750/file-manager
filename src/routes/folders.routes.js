const express = require('express');
const router = express.Router();
const folderService = require('../services/folder.service');
const { requireAuth, canWrite, canRead } = require('../middleware/auth');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/folders?parent_id=
 * List folders, or get folder tree.
 */
router.get('/', (req, res) => {
    const userId = req.session.userId;

    try {
        if (req.query.tree === 'true') {
            const tree = folderService.getFolderTree(userId);
            return res.json(tree);
        }

        const parentId = req.query.parent_id ? parseInt(req.query.parent_id) : null;
        const items = folderService.getFolderTree(userId, parentId);
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/folders
 * Create a new folder.
 */
router.post('/', (req, res) => {
    const userId = req.session.userId;
    const { name, parentId } = req.body;

    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    try {
        // Check write permission on parent
        if (parentId && !canWrite(userId, parseInt(parentId))) {
            return res.status(403).json({ error: 'No write permission for parent folder' });
        }

        const folder = folderService.createFolder(name, parentId || null, userId);
        res.json({ success: true, folder });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * PUT /api/folders/:id
 * Rename a folder.
 */
router.put('/:id', (req, res) => {
    const userId = req.session.userId;
    const folderId = parseInt(req.params.id);
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    try {
        folderService.renameFolder(folderId, name, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * DELETE /api/folders/:id
 * Delete a folder.
 */
router.delete('/:id', (req, res) => {
    const userId = req.session.userId;
    const folderId = parseInt(req.params.id);

    try {
        folderService.deleteFolder(folderId, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
