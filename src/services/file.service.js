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
 *
 * @param {object} file - Multer file object
 * @param {number} folderId - Target folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<number>} The inserted file metadata ID
 */
async function saveFileMetadata(file, folderId, userId) {
    const db = getDatabase();
    const ext = getExtension(file.originalname);
    const imageCheck = isImage(file.originalname);

    const [result] = await db.execute(
        `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            file.filename,
            file.originalname,
            folderId,
            userId,
            file.path,
            file.size,
            file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream',
            ext,
            imageCheck ? 1 : 0
        ]
    );

    const fileId = result.insertId;

    // Update image metadata asynchronously (dimensions + EXIF)
    if (imageCheck) {
        updateImageMetadata(file.path, fileId).catch(() => {});
    }

    // Update user storage
    await updateUsedStorage(userId);

    return fileId;
}

/**
 * Fetch image dimensions and EXIF data, then update the file_metadata row.
 *
 * @param {string} filePath - Path to the image file
 * @param {number} fileId - File metadata ID
 */
async function updateImageMetadata(filePath, fileId) {
    const db = getDatabase();
    const meta = await sharp(filePath).metadata();
    await db.execute(
        `UPDATE file_metadata SET width = ?, height = ?, exif_data = ? WHERE id = ?`,
        [
            meta.width || null,
            meta.height || null,
            meta.exif ? JSON.stringify(meta.exif) : null,
            fileId
        ]
    );
}

/**
 * Get image metadata (dimensions, EXIF).
 *
 * @param {string} filePath - Path to the image file
 * @returns {Promise<object|null>} Image metadata object
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
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<object|null>} Parsed EXIF data
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
 *
 * @param {string} filePath - Path to the image file
 * @param {number} maxWidth - Maximum thumbnail width
 * @param {number} maxHeight - Maximum thumbnail height
 * @returns {Promise<Buffer|null>} Thumbnail buffer
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
 *
 * @param {number} userId - Current user ID
 * @param {number|null} folderId - Target folder ID (null for root)
 * @returns {Promise<object>} Object with currentFolder, breadcrumbs, folders, files
 */
async function listItems(userId, folderId = null) {
    const db = getDatabase();

    // If folderId is null, get user's root folder
    let targetFolderId = folderId;
    if (!targetFolderId) {
        const [rootRows] = await db.execute(
            'SELECT id FROM folders WHERE owner_id = ? AND parent_id IS NULL',
            [userId]
        );
        if (rootRows.length > 0) {
            targetFolderId = rootRows[0].id;
        }
    }

    // Fetch subfolders — build SQL and params dynamically
    const folderSql = targetFolderId
        ? `SELECT id, name, parent_id, owner_id, created_at, updated_at
           FROM folders WHERE parent_id = ?
           AND (owner_id = ? OR id IN (SELECT folder_id FROM folder_permissions WHERE user_id = ?))
           ORDER BY name ASC`
        : `SELECT id, name, parent_id, owner_id, created_at, updated_at
           FROM folders WHERE parent_id IS NULL
           AND (owner_id = ? OR id IN (SELECT folder_id FROM folder_permissions WHERE user_id = ?))
           ORDER BY name ASC`;
    const folderParams = targetFolderId ? [targetFolderId, userId, userId] : [userId, userId];
    const [folders] = await db.execute(folderSql, folderParams);

    // Fetch files — build SQL and params dynamically
    const fileSql = targetFolderId
        ? `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                  created_at, updated_at
           FROM file_metadata WHERE folder_id = ?
           AND owner_id = ?
           ORDER BY name ASC`
        : `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                  created_at, updated_at
           FROM file_metadata WHERE folder_id IS NULL
           AND owner_id = ?
           ORDER BY name ASC`;
    const fileParams = targetFolderId ? [targetFolderId, userId] : [userId];
    const [files] = await db.execute(fileSql, fileParams);

    // Get current folder info for breadcrumbs
    let currentFolder = null;
    let breadcrumbs = [];
    if (targetFolderId) {
        const [folderRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [targetFolderId]);
        currentFolder = folderRows[0] || null;
        breadcrumbs = await getBreadcrumbs(targetFolderId);
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
 *
 * @param {number} folderId - Folder ID
 * @returns {Promise<object[]>} Array of folder objects from root to target
 */
async function getBreadcrumbs(folderId) {
    const db = getDatabase();
    const crumbs = [];
    let currentId = folderId;

    while (currentId) {
        const [rows] = await db.execute(
            'SELECT id, name, parent_id FROM folders WHERE id = ?',
            [currentId]
        );
        const folder = rows[0];
        if (!folder) break;
        crumbs.unshift(folder);
        currentId = folder.parent_id;
    }

    return crumbs;
}

/**
 * Search files and folders by name.
 *
 * @param {number} userId - Current user ID
 * @param {string} query - Search term
 * @param {number|null} folderId - Restrict search to this folder
 * @returns {Promise<object>} Object with folders and files arrays
 */
async function searchItems(userId, query, folderId = null) {
    const db = getDatabase();
    const searchTerm = `%${query}%`;

    let folderQuery = '';
    let folderParams = [];
    if (folderId) {
        folderQuery = 'AND folder_id = ?';
        folderParams = [folderId];
    }

    const [folders] = await db.execute(
        `SELECT id, name, parent_id, owner_id, created_at
         FROM folders
         WHERE name LIKE ?
         AND (owner_id = ? OR id IN (SELECT folder_id FROM folder_permissions WHERE user_id = ?))
         ORDER BY name ASC`,
        [searchTerm, userId, userId]
    );

    const [files] = await db.execute(
        `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, created_at
         FROM file_metadata
         WHERE (name LIKE ? OR original_name LIKE ?)
         AND owner_id = ?
         ${folderQuery}
         ORDER BY name ASC`,
        [searchTerm, searchTerm, userId, ...folderParams]
    );

    return { folders, files };
}

/**
 * Copy a file to another folder.
 *
 * @param {number} fileId - Source file ID
 * @param {number} targetFolderId - Target folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<number>} New file metadata ID
 */
async function copyFile(fileId, targetFolderId, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    // Get target folder path
    const [folderRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [targetFolderId]);
    const targetFolder = folderRows[0];
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
    const [result] = await db.execute(
        `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            newName,
            file.original_name,
            targetFolderId,
            userId,
            targetPath,
            stat.size,
            file.mime_type,
            file.extension,
            file.is_image
        ]
    );

    await updateUsedStorage(userId);
    return result.insertId;
}

/**
 * Move a file to another folder.
 *
 * @param {number} fileId - File ID
 * @param {number} targetFolderId - Target folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function moveFile(fileId, targetFolderId, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    const [folderRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [targetFolderId]);
    const targetFolder = folderRows[0];
    if (!targetFolder) throw new Error('Target folder not found');

    const sourcePath = file.path;
    const ext = file.extension;
    const baseName = path.basename(file.name, ext);
    const newName = `${Date.now()}_${baseName}${ext}`;
    const targetPath = safeJoinPath(path.dirname(targetFolder.path), newName);

    // Move the physical file
    fs.renameSync(sourcePath, targetPath);

    // Update file metadata
    await db.execute(
        `UPDATE file_metadata SET folder_id = ?, path = ?, name = ?, updated_at = NOW() WHERE id = ?`,
        [targetFolderId, targetPath, newName, fileId]
    );

    return true;
}

/**
 * Delete a file permanently.
 *
 * @param {number} fileId - File ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function deleteFile(fileId, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    // Delete physical file
    if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }

    // Delete metadata
    await db.execute('DELETE FROM file_metadata WHERE id = ?', [fileId]);
    await updateUsedStorage(userId);
    return true;
}

/**
 * Rename a file.
 *
 * @param {number} fileId - File ID
 * @param {string} newName - New filename
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function renameFile(fileId, newName, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    const safeName = sanitizeFilename(newName);
    if (!safeName) throw new Error('Invalid filename');

    const dir = path.dirname(file.path);
    const newPath = safeJoinPath(dir, safeName);

    if (fs.existsSync(newPath)) throw new Error('A file with this name already exists');

    fs.renameSync(file.path, newPath);

    await db.execute(
        `UPDATE file_metadata SET name = ?, original_name = ?, path = ?, extension = ?, is_image = ?, updated_at = NOW() WHERE id = ?`,
        [
            safeName,
            safeName,
            newPath,
            getExtension(safeName),
            isImage(safeName) ? 1 : 0,
            fileId
        ]
    );

    return true;
}

/**
 * Get file info.
 *
 * @param {number} fileId - File ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<object|undefined>} File metadata object
 */
async function getFileInfo(fileId, userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    return rows[0];
}

/**
 * Update file content (for text editing).
 *
 * @param {number} fileId - File ID
 * @param {string} content - New file content
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function updateFileContent(fileId, content, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    const buffer = Buffer.from(content, 'utf8');
    fs.writeFileSync(file.path, buffer);

    const stat = fs.statSync(file.path);
    await db.execute(
        `UPDATE file_metadata SET size = ?, updated_at = NOW() WHERE id = ?`,
        [stat.size, fileId]
    );

    await updateUsedStorage(userId);
    return true;
}

/**
 * Read file content (for text editing).
 *
 * @param {number} fileId - File ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<string>} File content
 */
async function readFileContent(fileId, userId) {
    const db = getDatabase();
    const [fileRows] = await db.execute(
        'SELECT * FROM file_metadata WHERE id = ? AND owner_id = ?',
        [fileId, userId]
    );
    const file = fileRows[0];
    if (!file) throw new Error('File not found');

    if (!fs.existsSync(file.path)) throw new Error('File not found on disk');

    const content = fs.readFileSync(file.path, 'utf8');
    return content;
}

/**
 * Create a zip archive of multiple files.
 *
 * @param {number[]} fileIds - Array of file IDs
 * @param {number} userId - Owner user ID
 * @returns {Promise<archiver.Archiver>} Archiver stream
 */
async function createZipArchive(fileIds, userId) {
    const db = getDatabase();
    const placeholders = fileIds.map(() => '?').join(',');
    const [files] = await db.execute(
        `SELECT * FROM file_metadata WHERE id IN (${placeholders}) AND owner_id = ?`,
        [...fileIds, userId]
    );

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
