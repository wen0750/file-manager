const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db/database');
const { sanitizeFilename, safeJoinPath } = require('../utils/helpers');
const { updateUsedStorage } = require('../middleware/quota');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

/**
 * Get or create user's root folder.
 */
function getRootFolder(userId) {
    const db = getDatabase();
    let rootFolder = db.prepare(
        'SELECT * FROM folders WHERE owner_id = ? AND parent_id IS NULL'
    ).get(userId);

    if (!rootFolder) {
        const folderPath = path.join(uploadDir, String(userId));
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        const result = db.prepare(
            `INSERT INTO folders (name, parent_id, owner_id, path) VALUES ('root', NULL, ?, ?)`
        ).run(userId, folderPath);
        rootFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
    }

    return rootFolder;
}

/**
 * Create a new folder.
 */
function createFolder(name, parentId, userId) {
    const db = getDatabase();

    const safeName = sanitizeFilename(name);
    if (!safeName) throw new Error('Invalid folder name');

    // Get parent folder
    let parentFolder;
    if (parentId) {
        parentFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(parentId);
        if (!parentFolder) throw new Error('Parent folder not found');
    } else {
        parentFolder = getRootFolder(userId);
    }

    // Create physical directory
    const newDirPath = safeJoinPath(parentFolder.path, safeName);
    if (fs.existsSync(newDirPath)) throw new Error('A folder with this name already exists');
    fs.mkdirSync(newDirPath, { recursive: true });

    // Create database record
    const result = db.prepare(
        `INSERT INTO folders (name, parent_id, owner_id, path) VALUES (?, ?, ?, ?)`
    ).run(safeName, parentFolder.id, userId, newDirPath);

    return db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Rename a folder.
 */
function renameFolder(folderId, newName, userId) {
    const db = getDatabase();
    const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(folderId, userId);
    if (!folder) throw new Error('Folder not found');
    if (folder.parent_id === null) throw new Error('Cannot rename root folder');

    const safeName = sanitizeFilename(newName);
    if (!safeName) throw new Error('Invalid folder name');

    const parentPath = path.dirname(folder.path);
    const newPath = safeJoinPath(parentPath, safeName);

    if (fs.existsSync(newPath)) throw new Error('A folder with this name already exists');
    fs.renameSync(folder.path, newPath);

    db.prepare(
        `UPDATE folders SET name = ?, path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(safeName, newPath, folderId);

    return true;
}

/**
 * Delete a folder and all its contents.
 */
function deleteFolder(folderId, userId) {
    const db = getDatabase();
    const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(folderId, userId);
    if (!folder) throw new Error('Folder not found');
    if (folder.parent_id === null) throw new Error('Cannot delete root folder');

    // Delete physical directory recursively
    if (fs.existsSync(folder.path)) {
        fs.rmSync(folder.path, { recursive: true, force: true });
    }

    // Delete all file metadata in this folder and subfolders
    deleteFolderContents(folderId, userId, db);

    // Delete folder record
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);

    updateUsedStorage(userId);
    return true;
}

/**
 * Recursively delete file metadata for a folder and its subfolders.
 */
function deleteFolderContents(folderId, userId, db) {
    // Delete files in this folder
    db.prepare('DELETE FROM file_metadata WHERE folder_id = ?').run(folderId);

    // Process subfolders
    const subfolders = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId);
    for (const sub of subfolders) {
        deleteFolderContents(sub.id, userId, db);
        db.prepare('DELETE FROM folders WHERE id = ?').run(sub.id);
    }
}

/**
 * Get folder by ID.
 */
function getFolder(folderId, userId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(folderId, userId);
}

/**
 * Get folder tree for navigation (user's folders only).
 */
function getFolderTree(userId, parentId = null) {
    const db = getDatabase();
    let folders;
    if (parentId) {
        folders = db.prepare(
            `SELECT id, name, parent_id FROM folders
             WHERE parent_id = ?
             AND owner_id = ?
             ORDER BY name ASC`
        ).all(parentId, userId);
    } else {
        folders = db.prepare(
            `SELECT id, name, parent_id FROM folders
             WHERE parent_id IS NULL
             AND owner_id = ?
             ORDER BY name ASC`
        ).all(userId);
    }

    return folders.map(f => ({
        ...f,
        children: getFolderTree(userId, f.id)
    }));
}

module.exports = {
    getRootFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    getFolder,
    getFolderTree
};
