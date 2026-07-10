const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { sanitizeFilename, getExtension } = require('../utils/helpers');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '2147483648', 10);

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Multer storage configuration.
 * Files are stored with a UUID prefix to avoid name collisions.
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Each user's files go to their own directory
        const userId = req.session.userId;
        const userDir = path.join(uploadDir, String(userId));

        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const safeName = sanitizeFilename(file.originalname);
        const ext = getExtension(safeName);
        const baseName = path.basename(safeName, ext);
        const uniqueName = `${uuidv4()}_${baseName}${ext}`;
        cb(null, uniqueName);
    }
});

/**
 * File filter to validate uploads.
 * Uses async IIFE because getSetting is now async.
 */
function fileFilter(req, file, cb) {
    (async () => {
        const { getSetting } = require('../db/database');
        const allowedExts = await getSetting('allowed_extensions', '');

        if (allowedExts) {
            const exts = allowedExts.split(',').map(e => e.trim().toLowerCase());
            const fileExt = getExtension(file.originalname);
            if (!exts.includes(fileExt)) {
                return cb(new Error(`File type ${fileExt} is not allowed`), false);
            }
        }

        // Block executable files for security
        const blockedExts = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.com', '.scr', '.vbs', '.msi'];
        const fileExt = getExtension(file.originalname);
        if (blockedExts.includes(fileExt)) {
            return cb(new Error(`File type ${fileExt} is blocked for security`), false);
        }

        cb(null, true);
    })().catch(err => cb(err));
}

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: maxFileSize,
        files: 50 // Max 50 files per upload request
    }
});

module.exports = upload;
