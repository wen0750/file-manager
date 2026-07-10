const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fileService = require('../services/file.service');
const folderService = require('../services/folder.service');
const upload = require('../middleware/upload');
const { requireAuth } = require('../middleware/auth');
const { canRead, canWrite, checkFolderPermission } = require('../middleware/auth');
const { getDatabase } = require('../db/database');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/files?folder_id=&search=
 * List files and folders in a directory or search.
 */
router.get('/', (req, res) => {
    const userId = req.session.userId;
    const folderId = req.query.folder_id ? parseInt(req.query.folder_id) : null;
    const search = req.query.search;

    try {
        if (search) {
            const results = fileService.searchItems(userId, search, folderId);
            return res.json(results);
        }
        const items = fileService.listItems(userId, folderId);
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/files/upload
 * Upload files with drag & drop support.
 */
router.post('/upload', upload.array('files', 50), async (req, res) => {
    const userId = req.session.userId;
    const folderId = req.body.folder_id ? parseInt(req.body.folder_id) : null;

    try {
        // Resolve target folder
        let targetFolderId = folderId;
        if (!targetFolderId) {
            const rootFolder = folderService.getRootFolder(userId);
            targetFolderId = rootFolder.id;
        }

        // Check write permission
        if (!canWrite(userId, targetFolderId)) {
            // Clean up uploaded files
            for (const file of req.files || []) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
            return res.status(403).json({ error: 'No write permission for this folder' });
        }

        // Check quota
        const { checkQuota } = require('../middleware/quota');
        const totalSize = (req.files || []).reduce((sum, f) => sum + f.size, 0);
        if (!checkQuota(userId, totalSize)) {
            for (const file of req.files || []) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
            return res.status(413).json({ error: 'Quota exceeded' });
        }

        // Save file metadata
        const fileIds = [];
        for (const file of req.files || []) {
            const id = fileService.saveFileMetadata(file, targetFolderId, userId);
            fileIds.push(id);
        }

        res.json({
            success: true,
            uploaded: fileIds.length,
            fileIds
        });
    } catch (e) {
        // Clean up on error
        for (const file of req.files || []) {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/files/download/:id
 * Download a single file.
 */
router.get('/download/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        const file = fileService.getFileInfo(fileId, userId);
        if (!file) return res.status(404).json({ error: 'File not found' });

        if (!fs.existsSync(file.path)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.download(file.path, file.original_name);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/files/download-zip
 * Download multiple files as a zip archive.
 */
router.post('/download-zip', (req, res) => {
    const userId = req.session.userId;
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'No files specified' });
    }

    try {
        const numericIds = fileIds.map(id => parseInt(id));
        const archive = fileService.createZipArchive(numericIds, userId);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="files-${Date.now()}.zip"`);

        archive.pipe(res);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/files/preview/:id
 * Stream a file for preview (images, videos, audio, PDF).
 */
router.get('/preview/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        const file = fileService.getFileInfo(fileId, userId);
        if (!file) return res.status(404).json({ error: 'File not found' });

        if (!fs.existsSync(file.path)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const stat = fs.statSync(file.path);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            // Support range requests for videos/audio
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = end - start + 1;

            const stream = fs.createReadStream(file.path, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': file.mime_type
            });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': file.mime_type
            });
            fs.createReadStream(file.path).pipe(res);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/files/thumbnail/:id
 * Get a thumbnail for an image.
 */
router.get('/thumbnail/:id', async (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        const file = fileService.getFileInfo(fileId, userId);
        if (!file || !file.is_image) return res.status(404).json({ error: 'Not found' });

        const thumbnail = await fileService.generateThumbnail(file.path);
        if (!thumbnail) return res.status(500).json({ error: 'Failed to generate thumbnail' });

        res.setHeader('Content-Type', 'image/jpeg');
        res.send(thumbnail);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/files/info/:id
 * Get file info including image metadata.
 */
router.get('/info/:id', async (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        const file = fileService.getFileInfo(fileId, userId);
        if (!file) return res.status(404).json({ error: 'File not found' });

        let imageMeta = null;
        if (file.is_image) {
            imageMeta = await fileService.getImageMetadata(file.path);
        }

        res.json({ ...file, imageMeta });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/files/content/:id
 * Get file content for editing (text files only).
 */
router.get('/content/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        const content = fileService.readFileContent(fileId, userId);
        res.json({ content });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * PUT /api/files/content/:id
 * Update file content (save edits).
 */
router.put('/content/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);
    const { content } = req.body;

    if (content === undefined) {
        return res.status(400).json({ error: 'Content is required' });
    }

    try {
        fileService.updateFileContent(fileId, content, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * PUT /api/files/rename/:id
 * Rename a file.
 */
router.put('/rename/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    try {
        fileService.renameFile(fileId, name, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * POST /api/files/copy
 * Copy files to another folder.
 */
router.post('/copy', (req, res) => {
    const userId = req.session.userId;
    const { fileIds, targetFolderId } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || !targetFolderId) {
        return res.status(400).json({ error: 'fileIds and targetFolderId are required' });
    }

    try {
        if (!canWrite(userId, parseInt(targetFolderId))) {
            return res.status(403).json({ error: 'No write permission for target folder' });
        }

        for (const id of fileIds) {
            fileService.copyFile(parseInt(id), parseInt(targetFolderId), userId);
        }
        res.json({ success: true, copied: fileIds.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/files/move
 * Move files to another folder.
 */
router.post('/move', (req, res) => {
    const userId = req.session.userId;
    const { fileIds, targetFolderId } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || !targetFolderId) {
        return res.status(400).json({ error: 'fileIds and targetFolderId are required' });
    }

    try {
        if (!canWrite(userId, parseInt(targetFolderId))) {
            return res.status(403).json({ error: 'No write permission for target folder' });
        }

        for (const id of fileIds) {
            fileService.moveFile(parseInt(id), parseInt(targetFolderId), userId);
        }
        res.json({ success: true, moved: fileIds.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/files/:id
 * Delete a file.
 */
router.delete('/:id', (req, res) => {
    const userId = req.session.userId;
    const fileId = parseInt(req.params.id);

    try {
        fileService.deleteFile(fileId, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/files/batch-delete
 * Delete multiple files.
 */
router.post('/batch-delete', (req, res) => {
    const userId = req.session.userId;
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds)) {
        return res.status(400).json({ error: 'fileIds is required' });
    }

    try {
        let deleted = 0;
        for (const id of fileIds) {
            try {
                fileService.deleteFile(parseInt(id), userId);
                deleted++;
            } catch (e) {
                // Continue with other files
            }
        }
        res.json({ success: true, deleted });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
