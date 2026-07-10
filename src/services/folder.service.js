const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db/database');
const { sanitizeFilename, safeJoinPath } = require('../utils/helpers');
const { updateUsedStorage } = require('../middleware/quota');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

/**
 * Get or create user's root folder.
 *
 * @param {number} userId - User ID
 * @returns {Promise<object>} Root folder object
 */
async function getRootFolder(userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM folders WHERE owner_id = ? AND parent_id IS NULL',
        [userId]
    );
    let rootFolder = rows[0];

    if (!rootFolder) {
        const folderPath = path.join(uploadDir, String(userId));
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        const [result] = await db.execute(
            `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`,
            [userId, folderPath]
        );
        const [newRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [result.insertId]);
        rootFolder = newRows[0];
    }

    return rootFolder;
}

/**
 * Create a new folder.
 *
 * @param {string} name - Folder name
 * @param {number|null} parentId - Parent folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<object>} Created folder object
 */
async function createFolder(name, parentId, userId) {
    const db = getDatabase();

    const safeName = sanitizeFilename(name);
    if (!safeName) throw new Error('Invalid folder name');

    // Get parent folder
    let parentFolder;
    if (parentId) {
        const [rows] = await db.execute('SELECT * FROM folders WHERE id = ?', [parentId]);
        parentFolder = rows[0];
        if (!parentFolder) throw new Error('Parent folder not found');
    } else {
        parentFolder = await getRootFolder(userId);
    }

    // Create physical directory
    const newDirPath = safeJoinPath(parentFolder.path, safeName);
    if (fs.existsSync(newDirPath)) throw new Error('A folder with this name already exists');
    fs.mkdirSync(newDirPath, { recursive: true });

    // Create database record
    const [result] = await db.execute(
        `INSERT INTO folders (name, parent_id, owner_id, path) VALUES (?, ?, ?, ?)`,
        [safeName, parentFolder.id, userId, newDirPath]
    );

    const [newRows] = await db.execute('SELECT * FROM folders WHERE id = ?', [result.insertId]);
    return newRows[0];
}

/**
 * Rename a folder.
 *
 * @param {number} folderId - Folder ID
 * @param {string} newName - New folder name
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function renameFolder(folderId, newName, userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM folders WHERE id = ? AND owner_id = ?',
        [folderId, userId]
    );
    const folder = rows[0];
    if (!folder) throw new Error('Folder not found');
    if (folder.parent_id === null) throw new Error('Cannot rename root folder');

    const safeName = sanitizeFilename(newName);
    if (!safeName) throw new Error('Invalid folder name');

    const parentPath = path.dirname(folder.path);
    const newPath = safeJoinPath(parentPath, safeName);

    if (fs.existsSync(newPath)) throw new Error('A folder with this name already exists');
    fs.renameSync(folder.path, newPath);

    await db.execute(
        `UPDATE folders SET name = ?, path = ?, updated_at = NOW() WHERE id = ?`,
        [safeName, newPath, folderId]
    );

    return true;
}

/**
 * Delete a folder and all its contents.
 *
 * @param {number} folderId - Folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<boolean>} True on success
 */
async function deleteFolder(folderId, userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM folders WHERE id = ? AND owner_id = ?',
        [folderId, userId]
    );
    const folder = rows[0];
    if (!folder) throw new Error('Folder not found');
    if (folder.parent_id === null) throw new Error('Cannot delete root folder');

    // Delete physical directory recursively
    if (fs.existsSync(folder.path)) {
        fs.rmSync(folder.path, { recursive: true, force: true });
    }

    // Delete all file metadata in this folder and subfolders
    await deleteFolderContents(folderId);

    // Delete folder record
    await db.execute('DELETE FROM folders WHERE id = ?', [folderId]);

    await updateUsedStorage(userId);
    return true;
}

/**
 * Recursively delete file metadata for a folder and its subfolders.
 *
 * @param {number} folderId - Folder ID
 */
async function deleteFolderContents(folderId) {
    const db = getDatabase();

    // Delete files in this folder
    await db.execute('DELETE FROM file_metadata WHERE folder_id = ?', [folderId]);

    // Process subfolders
    const [subfolders] = await db.execute(
        'SELECT id FROM folders WHERE parent_id = ?',
        [folderId]
    );
    for (const sub of subfolders) {
        await deleteFolderContents(sub.id);
        await db.execute('DELETE FROM folders WHERE id = ?', [sub.id]);
    }
}

/**
 * Get folder by ID.
 *
 * @param {number} folderId - Folder ID
 * @param {number} userId - Owner user ID
 * @returns {Promise<object|undefined>} Folder object
 */
async function getFolder(folderId, userId) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT * FROM folders WHERE id = ? AND owner_id = ?',
        [folderId, userId]
    );
    return rows[0];
}

/**
 * Get folder tree for navigation (user's folders only).
 *
 * @param {number} userId - Owner user ID
 * @param {number|null} parentId - Parent folder ID (null for root level)
 * @returns {Promise<object[]>} Array of folder objects with children
 */
async function getFolderTree(userId, parentId = null) {
    const db = getDatabase();
    let folders;
    if (parentId) {
        [folders] = await db.execute(
            `SELECT id, name, parent_id FROM folders
             WHERE parent_id = ?
             AND owner_id = ?
             ORDER BY name ASC`,
            [parentId, userId]
        );
    } else {
        [folders] = await db.execute(
            `SELECT id, name, parent_id FROM folders
             WHERE parent_id IS NULL
             AND owner_id = ?
             ORDER BY name ASC`,
            [userId]
        );
    }

    const childrenPromises = folders.map(async (f) => ({
        ...f,
        children: await getFolderTree(userId, f.id)
    }));
    return Promise.all(childrenPromises);
}

module.exports = {
    getRootFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    getFolder,
    getFolderTree
};
