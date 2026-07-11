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
const {
    collectFilesystemFiles,
    isFilesystemScanEnabled,
    mergeFilesystemOnlyFiles
} = require('./filesystem-scan.service');

function shouldPreserveUploadFilename() {
    return String(process.env.PRESERVE_UPLOAD_FILENAME || '').toLowerCase() === 'true';
}

function stripGeneratedUploadPrefix(filename) {
    if (!filename) {
        return '';
    }

    const patterns = [
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(.+)$/i,
        /^\d{10,}_(.+)$/
    ];

    for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    return filename;
}

function sanitizeUploadFilename(filename) {
    const baseName = path.basename(String(filename || ''));
    const cleaned = baseName
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim();

    return cleaned || 'unnamed';
}

function normalizeUploadedFilename(filename) {
    const originalValue = String(filename || '');

    try {
        const decodedValue = Buffer.from(originalValue, 'latin1').toString('utf8');
        const originalHasCjk = /[\u3400-\u9fff]/.test(originalValue);
        const decodedHasCjk = /[\u3400-\u9fff]/.test(decodedValue);

        if (!originalHasCjk && decodedHasCjk) {
            return decodedValue;
        }
    } catch (error) {
        return originalValue;
    }

    return originalValue;
}

function getPreferredUploadFilename(file) {
    const originalName = stripGeneratedUploadPrefix(
        sanitizeUploadFilename(normalizeUploadedFilename(file.originalname)) || ''
    );
    const generatedName = stripGeneratedUploadPrefix(
        sanitizeUploadFilename(file.filename) || ''
    );

    return originalName || generatedName || file.filename;
}

function getUniqueFilename(directoryPath, desiredName) {
    const ext = path.extname(desiredName);
    const baseName = path.basename(desiredName, ext);
    let candidate = desiredName;
    let counter = 1;

    while (fs.existsSync(path.join(directoryPath, candidate))) {
        candidate = `${baseName} (${counter})${ext}`;
        counter += 1;
    }

    return candidate;
}

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
    const normalizedOriginalName = normalizeUploadedFilename(file.originalname);
    file.originalname = normalizedOriginalName;
    const preserveOriginalName = shouldPreserveUploadFilename();
    const desiredFilename = preserveOriginalName
        ? getPreferredUploadFilename(file)
        : file.filename;
    let storedFileName = desiredFilename;
    let storedFilePath = file.path;

    if (folderId) {
        const [folderRows] = await db.execute(
            'SELECT id, path FROM folders WHERE id = ?',
            [folderId]
        );
        const targetFolder = folderRows[0];
        if (!targetFolder) throw new Error('Target folder not found');

        if (targetFolder.path) {
            if (!fs.existsSync(targetFolder.path)) {
                fs.mkdirSync(targetFolder.path, { recursive: true });
            }

            storedFileName = getUniqueFilename(targetFolder.path, desiredFilename);
            const targetPath = safeJoinPath(targetFolder.path, storedFileName);
            if (path.resolve(file.path) !== path.resolve(targetPath)) {
                fs.renameSync(file.path, targetPath);
            }
            storedFilePath = targetPath;
            file.path = targetPath;
        }
    } else if (preserveOriginalName) {
        storedFileName = getUniqueFilename(path.dirname(file.path), desiredFilename);
        const targetPath = safeJoinPath(path.dirname(file.path), storedFileName);
        if (path.resolve(file.path) !== path.resolve(targetPath)) {
            fs.renameSync(file.path, targetPath);
        }
        storedFilePath = targetPath;
        file.path = targetPath;
    }

    const ext = getExtension(file.originalname);
    const imageCheck = isImage(file.originalname);

    const [result] = await db.execute(
        `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            storedFileName,
            normalizedOriginalName,
            folderId,
            userId,
            storedFilePath,
            file.size,
            file.mimetype || mime.lookup(normalizedOriginalName) || 'application/octet-stream',
            ext,
            imageCheck ? 1 : 0
        ]
    );

    const fileId = result.insertId;

    // Update image metadata asynchronously (dimensions + EXIF)
    if (imageCheck) {
        updateImageMetadata(storedFilePath, fileId).catch(() => {});
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
                  path, created_at, updated_at
           FROM file_metadata WHERE folder_id = ?
           AND owner_id = ?
           ORDER BY name ASC`
        : `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                  path, created_at, updated_at
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

    const scanDirectoryPath =
        currentFolder?.path ||
        (files && files.length > 0 && files[0]?.path ? path.dirname(files[0].path) : null);
    const canSyncFilesystemFiles = !currentFolder || currentFolder.owner_id === userId;

    const mergedFiles = await syncFilesystemFilesToMetadata(
        userId,
        targetFolderId || null,
        files || [],
        canSyncFilesystemFiles ? scanDirectoryPath : null
    );

    return {
        currentFolder,
        breadcrumbs,
        folders: folders || [],
        files: mergedFiles
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

    if (isFilesystemScanEnabled()) {
        const syncDirectoryPath = await getFolderScanPath(db, userId, folderId);
        if (syncDirectoryPath) {
            const [existingRows] = await db.execute(
                folderId
                    ? `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                              path, created_at, updated_at
                       FROM file_metadata
                       WHERE folder_id = ? AND owner_id = ?
                       ORDER BY name ASC`
                    : `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                              path, created_at, updated_at
                       FROM file_metadata
                       WHERE folder_id IS NULL AND owner_id = ?
                       ORDER BY name ASC`,
                folderId ? [folderId, userId] : [userId]
            );

            await syncFilesystemFilesToMetadata(
                userId,
                folderId || null,
                existingRows || [],
                syncDirectoryPath
            );
        }
    }

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
        `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, path, created_at
         FROM file_metadata
         WHERE (name LIKE ? OR original_name LIKE ?)
         AND owner_id = ?
         ${folderQuery}
         ORDER BY name ASC`,
        [searchTerm, searchTerm, userId, ...folderParams]
    );

    const mergedFiles = await mergeFilesystemSearchResults(db, userId, query, folderId, files || []);

    return { folders, files: mergedFiles };
}

async function getFolderScanPath(db, userId, folderId = null) {
    if (folderId) {
        const [folderRows] = await db.execute(
            'SELECT path, owner_id FROM folders WHERE id = ?',
            [folderId]
        );
        const folder = folderRows[0];
        if (folder && folder.path && folder.owner_id === userId) {
            return folder.path;
        }
        return null;
    }

    const [rootRows] = await db.execute(
        'SELECT path FROM folders WHERE owner_id = ? AND parent_id IS NULL LIMIT 1',
        [userId]
    );

    return rootRows.length > 0 ? rootRows[0].path || null : null;
}

async function syncFilesystemFilesToMetadata(userId, folderId, existingFiles, directoryPath) {
    const databaseFiles = Array.isArray(existingFiles) ? existingFiles : [];
    const normalizedDatabaseFiles = databaseFiles.map((file) => ({
        ...file,
        inDatabase: true,
        source: 'database'
    }));

    if (!isFilesystemScanEnabled() || !directoryPath) {
        return normalizedDatabaseFiles;
    }

    const db = getDatabase();
    const existingPaths = new Set(
        normalizedDatabaseFiles
            .map((file) => path.resolve(file.path || ''))
            .filter(Boolean)
    );

    const filesystemFiles = await collectFilesystemFiles(directoryPath, folderId);
    const insertedFiles = [];

    for (const filesystemFile of filesystemFiles) {
        const resolvedPath = path.resolve(filesystemFile.path || '');
        if (!resolvedPath || existingPaths.has(resolvedPath)) {
            continue;
        }

        const [matchedRows] = await db.execute(
            `SELECT id, name, original_name, folder_id, size, mime_type, extension, is_image, width, height,
                    path, created_at, updated_at
             FROM file_metadata
             WHERE owner_id = ? AND path = ?
             LIMIT 1`,
            [userId, filesystemFile.path]
        );

        if (matchedRows.length > 0) {
            existingPaths.add(resolvedPath);
            normalizedDatabaseFiles.push({
                ...matchedRows[0],
                inDatabase: true,
                source: 'database'
            });
            continue;
        }

        const [result] = await db.execute(
            `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                filesystemFile.name,
                filesystemFile.original_name,
                folderId,
                userId,
                filesystemFile.path,
                filesystemFile.size,
                filesystemFile.mime_type,
                filesystemFile.extension,
                filesystemFile.is_image
            ]
        );

        const insertedFile = {
            id: result.insertId,
            name: filesystemFile.name,
            original_name: filesystemFile.original_name,
            folder_id: folderId,
            size: filesystemFile.size,
            mime_type: filesystemFile.mime_type,
            extension: filesystemFile.extension,
            is_image: filesystemFile.is_image,
            width: null,
            height: null,
            path: filesystemFile.path,
            created_at: filesystemFile.created_at,
            updated_at: filesystemFile.updated_at,
            inDatabase: true,
            source: 'database'
        };

        if (filesystemFile.is_image) {
            updateImageMetadata(filesystemFile.path, insertedFile.id).catch(() => {});
        }

        insertedFiles.push(insertedFile);
        existingPaths.add(resolvedPath);
    }

    return [...normalizedDatabaseFiles, ...insertedFiles].sort((a, b) => a.name.localeCompare(b.name));
}

async function mergeFilesystemSearchResults(db, userId, query, folderId, files) {
    const databaseFiles = Array.isArray(files) ? files : [];
    const normalizedDatabaseFiles = databaseFiles.map((file) => ({
        ...file,
        inDatabase: true,
        source: file?.source || 'database'
    }));

    if (!isFilesystemScanEnabled()) {
        return normalizedDatabaseFiles;
    }

    let scanDirectoryPath = null;
    if (folderId) {
        const [folderRows] = await db.execute(
            'SELECT path, owner_id FROM folders WHERE id = ?',
            [folderId]
        );
        const folder = folderRows[0];
        if (folder && folder.path && folder.owner_id === userId) {
            scanDirectoryPath = folder.path;
        }
    } else {
        const [rootRows] = await db.execute(
            'SELECT path FROM folders WHERE owner_id = ? AND parent_id IS NULL LIMIT 1',
            [userId]
        );
        if (rootRows.length > 0) {
            scanDirectoryPath = rootRows[0].path || null;
        }
    }

    if (!scanDirectoryPath) {
        return normalizedDatabaseFiles;
    }

    const existingPaths = new Set(
        normalizedDatabaseFiles
            .map((file) => path.resolve(file.path || ''))
            .filter(Boolean)
    );

    const loweredQuery = String(query || '').toLowerCase();
    const filesystemFiles = await collectFilesystemFiles(scanDirectoryPath, folderId || null);
    const missingDbFiles = filesystemFiles.filter((file) => {
        const resolvedPath = path.resolve(file.path || '');
        if (existingPaths.has(resolvedPath)) {
            return false;
        }

        const searchableName = `${file.name} ${file.original_name}`.toLowerCase();
        return searchableName.includes(loweredQuery);
    });

    if (missingDbFiles.length === 0) {
        return normalizedDatabaseFiles.sort((a, b) => a.name.localeCompare(b.name));
    }

    const syncedFiles = await syncFilesystemFilesToMetadata(
        userId,
        folderId || null,
        normalizedDatabaseFiles,
        scanDirectoryPath
    );

    return syncedFiles.filter((file) => {
        const searchableName = `${file.name} ${file.original_name || ''}`.toLowerCase();
        return searchableName.includes(loweredQuery);
    });
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
    const targetPath = safeJoinPath(targetFolder.path, newName);

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
    const targetPath = safeJoinPath(targetFolder.path, newName);

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

    const safeName = sanitizeUploadFilename(newName);
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
