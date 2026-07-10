const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const sharp = require('sharp');
const mime = require('mime-types');
const exifr = require('exifr');
const { getDatabase } = require('../db/database');
const {
    sanitizeFilename,
    safeJoinPath,
    getExtension,
    isImage,
    getDirectorySize,
    formatBytes
} = require('../utils/helpers');
const { updateUsedStorage } = require('../middleware/quota');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

/**
 * Save uploaded file metadata to database.
 */
function saveFileMetadata(file, folderId, userId) {
    const db = getDatabase();
    const ext = getExtension(file.originalname);
    const imageCheck = isImage(file.originalname);

    let width = null, height = null, exifData = null;

    // Get image dimensions and EXIF data
    if (imageCheck) {
        try {
            const metadata = sharp(file.path).metadata();
            // sharp metadata is async, but we need to handle it
            // We'll store what we can synchronously and update later
        } catch (e) {
            // Ignore EXIF errors
        }
    }

    const result = db.prepare(
        `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        file.filename,
        file.originalname,
        folderId,
        userId,
        file.path,
        file.size,
        file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream',
        ext,
        imageCheck ? 1 : 0
    );

    // Update image metadata asynchronously
    if (imageCheck) {
        sharp(file.path).metadata().then(meta => {
            db.prepare(
                `UPDATE file_metadata SET width = ?, height = ?, exif_data = ? WHERE id = ?`
            ).run(
                meta.width || null,
                meta.height || null,
                meta.exif ? JSON.stringify(meta.exif) : null,
                result.lastInsertRowid
            );
        }).catch(() => {});
    }

    // Update user storage
    updateUsedStorage(userId);

    return result.lastInsertRowid;
}

/**
 * Get image metadata (dimensions, EXIF).
 */
async function getImageMetadata(filePath) {
    try {
        const metadata = await sharp(filePath).metadata();
        const exif = await parseExif(filePath);
        return {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            space: metadata.space,
            density: metadata.density,
            hasAlpha: metadata.hasAlpha,
            exif
        };
    } catch (e) {
        return null;
    }
}

/**
 * Parse EXIF data from file path using exifr.
 */
async function parseExif(filePath) {
    try {
        const exif = await exifr.parse(filePath);
        if (!exif) return null;

        const result = {};

        if (exif.Make || exif.Model) {
            result.camera = { make: exif.Make || null, model: exif.Model || null };
        }

        if (exif.DateTimeOriginal || exif.DateTime) {
            result.dateTaken = exif.DateTimeOriginal || exif.DateTime;
        }

        if (exif.FNumber || exif.ExposureTime || exif.ISO) {
            result.exposure = {
                aperture: exif.FNumber || null,
                shutter: exif.ExposureTime || null,
                iso: exif.ISO || null
            };
        }

        if (exif.FocalLength) {
            result.focalLength = exif.FocalLength;
        }

        if (exif.Orientation) {
            result.orientation = exif.Orientation;
        }

        if (exif.latitude && exif.longitude) {
            result.gps = { lat: exif.latitude, lng: exif.longitude };
        }

        if (exif.Software) {
            result.software = exif.Software;
        }

        return Object.keys(result).length > 0 ? result : null;
    } catch (e) {
        return null;
    }
}

/**
 * Generate a thumbnail for an image.
 */
async function generateThumbnail(filePath, maxWidth = 200, maxHeight = 200) {
    try {
        const thumbnail = await sharp(filePath)
            .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        return thumbnail;
    } catch (e) {
        return null;
    }
}

/**
 * List files and folders in a directory.
 */
function listItems(userId, folderId = null) {
    const db = getDatabase();

    // If folderId is null, get user's root folder
    let targetFolderId = folderId;
    if (!targetFolderId) {
        const rootFolder = db.prepare(
            'SELECT id FROM folders WHERE owner_id = ? AND parent_id IS NULL'
        ).get(userId);
        if (rootFolder) {
            targetFolderId = rootFolder.id;
        }
    }

    const folders = db.prepare(
        `SELECT id, name, parent_id, owner_id, created_at, updated_at
         FROM folders WHERE parent_id ${targetFolderId ? '= ?' : 'IS NULL'}
         AND (owner_id = ? OR id IN (SELECT folder_id FROM folder_permissions WHERE user_id = ?))
         ORDER BY name ASC`
    ).all(targetFolderId, userId, userId);

    const files = db.prepare(
        `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                created_at, updated_at
         FROM file_metadata WHERE folder_id ${targetFolderId ? '= ?' : 'IS NULL'}
         AND owner_id = ?
         ORDER BY name ASC`
    ).all(targetFolderId, userId);

    // Get current folder info for breadcrumbs
    let currentFolder = null;
    let breadcrumbs = [];
    if (targetFolderId) {
        currentFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(targetFolderId);
        breadcrumbs = getBreadcrumbs(targetFolderId);
    }

    return {
        currentFolder,
        breadcrumbs,
        folders: folders || [],
        files: files || []
    };
}

/**
 * Get breadcrumb path for a folder.
 */
function getBreadcrumbs(folderId) {
    const db = getDatabase();
    const crumbs = [];
    let currentId = folderId;

    while (currentId) {
        const folder = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(currentId);
        if (!folder) break;
        crumbs.unshift(folder);
        currentId = folder.parent_id;
    }

    return crumbs;
}

/**
 * Search files and folders by name.
 */
function searchItems(userId, query, folderId = null) {
    const db = getDatabase();
    const searchTerm = `%${query}%`;

    let folderQuery = '';
    let folderParams = [];
    if (folderId) {
        folderQuery = 'AND folder_id = ?';
        folderParams = [folderId];
    }

    const folders = db.prepare(
        `SELECT id, name, parent_id, owner_id, created_at
         FROM folders
         WHERE name LIKE ?
         AND (owner_id = ? OR id IN (SELECT folder_id FROM folder_permissions WHERE user_id = ?))
         ORDER BY name ASC`
    ).all(searchTerm, userId, userId);

    const files = db.prepare(
        `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, created_at
         FROM file_metadata
         WHERE (name LIKE ? OR original_name LIKE ?)
         AND owner_id = ?
         ${folderQuery}
         ORDER BY name ASC`
    ).all(searchTerm, searchTerm, userId, ...folderParams);

    return { folders, files };
}

/**
 * Copy a file to another folder.
 */
function copyFile(fileId, targetFolderId, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    // Get target folder path
    const targetFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(targetFolderId);
    if (!targetFolder) throw new Error('Target folder not found');

    const sourcePath = file.path;
    const ext = file.extension;
    const baseName = path.basename(file.name, ext);
    const newName = `${Date.now()}_${baseName}${ext}`;
    const targetPath = safeJoinPath(path.dirname(targetFolder.path), newName);

    // Copy the physical file
    fs.copyFileSync(sourcePath, targetPath);
    const stat = fs.statSync(targetPath);

    // Insert new file metadata
    const result = db.prepare(
        `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        newName,
        file.original_name,
        targetFolderId,
        userId,
        targetPath,
        stat.size,
        file.mime_type,
        file.extension,
        file.is_image
    );

    updateUsedStorage(userId);
    return result.lastInsertRowid;
}

/**
 * Move a file to another folder.
 */
function moveFile(fileId, targetFolderId, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    const targetFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(targetFolderId);
    if (!targetFolder) throw new Error('Target folder not found');

    const sourcePath = file.path;
    const ext = file.extension;
    const baseName = path.basename(file.name, ext);
    const newName = `${Date.now()}_${baseName}${ext}`;
    const targetPath = safeJoinPath(path.dirname(targetFolder.path), newName);

    // Move the physical file
    fs.renameSync(sourcePath, targetPath);

    // Update file metadata
    db.prepare(
        `UPDATE file_metadata SET folder_id = ?, path = ?, name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(targetFolderId, targetPath, newName, fileId);

    return true;
}

/**
 * Delete a file permanently.
 */
function deleteFile(fileId, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    // Delete physical file
    if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }

    // Delete metadata
    db.prepare('DELETE FROM file_metadata WHERE id = ?').run(fileId);
    updateUsedStorage(userId);
    return true;
}

/**
 * Rename a file.
 */
function renameFile(fileId, newName, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    const safeName = sanitizeFilename(newName);
    if (!safeName) throw new Error('Invalid filename');

    const dir = path.dirname(file.path);
    const newPath = safeJoinPath(dir, safeName);

    if (fs.existsSync(newPath)) throw new Error('A file with this name already exists');

    fs.renameSync(file.path, newPath);

    db.prepare(
        `UPDATE file_metadata SET name = ?, original_name = ?, path = ?, extension = ?, is_image = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
        safeName,
        safeName,
        newPath,
        getExtension(safeName),
        isImage(safeName) ? 1 : 0,
        fileId
    );

    return true;
}

/**
 * Get file info.
 */
function getFileInfo(fileId, userId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
}

/**
 * Update file content (for text editing).
 */
function updateFileContent(fileId, content, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    const buffer = Buffer.from(content, 'utf8');
    fs.writeFileSync(file.path, buffer);

    const stat = fs.statSync(file.path);
    db.prepare(
        `UPDATE file_metadata SET size = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(stat.size, fileId);

    updateUsedStorage(userId);
    return true;
}

/**
 * Read file content (for text editing).
 */
function readFileContent(fileId, userId) {
    const db = getDatabase();
    const file = db.prepare('SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) throw new Error('File not found');

    if (!fs.existsSync(file.path)) throw new Error('File not found on disk');

    const content = fs.readFileSync(file.path, 'utf8');
    return content;
}

/**
 * Create a zip archive of multiple files.
 */
function createZipArchive(fileIds, userId) {
    const db = getDatabase();
    const files = db.prepare(
        `SELECT * FROM file_metadata WHERE id IN (${fileIds.map(() => '?').join(',')}) AND owner_id = ?`
    ).all(...fileIds, userId);

    const archive = archiver('zip', { zlib: { level: 5 } });
    for (const file of files) {
        if (fs.existsSync(file.path)) {
            archive.file(file.path, { name: file.original_name });
        }
    }
    archive.finalize();
    return archive;
}

module.exports = {
    saveFileMetadata,
    getImageMetadata,
    generateThumbnail,
    listItems,
    getBreadcrumbs,
    searchItems,
    copyFile,
    moveFile,
    deleteFile,
    renameFile,
    getFileInfo,
    updateFileContent,
    readFileContent,
    createZipArchive
};
