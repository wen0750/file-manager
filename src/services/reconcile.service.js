const fs = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const { getDatabase } = require('../db/database');
const { getExtension, isImage } = require('../utils/helpers');
const { recalculateStorage } = require('./quota.service');

/**
 * Full reconciliation between the filesystem and the file_metadata table.
 *
 * This is the source of truth for files that are created or modified outside
 * the application (logs, files copied directly into the storage directory,
 * auto-generated files). It is a heavyweight, off-request-path job intended to
 * run once per day, and it corrects any drift accumulated by the incremental
 * counter or missed by the file watcher.
 *
 * The three cases it handles:
 *  - file exists in DB and disk but `size` changed  -> UPDATE (catches in-place growth)
 *  - file exists on disk but not in DB             -> INSERT (new external file)
 *  - file exists in DB but not on disk             -> DELETE (orphan)
 * Afterwards `used_bytes` is re-derived from the database aggregate.
 */

let running = false;

function normalizePath(value) {
    return path.resolve(String(value || ''));
}

/**
 * Recursively collect regular files under a directory.
 *
 * @param {string} directoryPath
 * @param {Array<{path:string,size:number,mtime:Date}>} [acc]
 * @returns {Promise<Array<{path:string,size:number,mtime:Date}>>}
 */
async function collectDiskFiles(directoryPath, acc = []) {
    let entries;
    try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        return acc;
    }

    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            await collectDiskFiles(fullPath, acc);
        } else if (entry.isFile()) {
            try {
                const stats = await fs.stat(fullPath);
                acc.push({ path: fullPath, size: stats.size, mtime: stats.mtime });
            } catch (error) {
                // File disappeared between readdir and stat — ignore.
            }
        }
    }

    return acc;
}

/**
 * Reconcile a single user's storage root.
 *
 * @param {number} userId
 * @returns {Promise<{inserted:number,updated:number,deleted:number}>}
 */
async function reconcileUser(userId) {
    const db = getDatabase();
    const [rootRows] = await db.execute(
        'SELECT id, path FROM folders WHERE owner_id = ? AND parent_id IS NULL LIMIT 1',
        [userId]
    );
    const root = rootRows[0];

    if (!root || !root.path) {
        await recalculateStorage(userId);
        return { inserted: 0, updated: 0, deleted: 0 };
    }

    // Guard against a temporarily unavailable mount: never mass-delete rows if
    // the root directory itself is not reachable.
    try {
        await fs.access(root.path);
    } catch (error) {
        console.warn(`[reconcile] root path unavailable for user ${userId}, skipping: ${root.path}`);
        return { inserted: 0, updated: 0, deleted: 0 };
    }

    const [folders] = await db.execute(
        'SELECT id, path FROM folders WHERE owner_id = ?',
        [userId]
    );
    const folderByPath = new Map();
    for (const folder of folders) {
        if (folder.path) folderByPath.set(normalizePath(folder.path), folder.id);
    }

    const [dbFiles] = await db.execute(
        'SELECT id, path, size FROM file_metadata WHERE owner_id = ?',
        [userId]
    );
    const dbByPath = new Map();
    for (const file of dbFiles) {
        dbByPath.set(normalizePath(file.path), file);
    }

    const diskFiles = await collectDiskFiles(root.path);
    const seenPaths = new Set();
    let inserted = 0;
    let updated = 0;

    for (const diskFile of diskFiles) {
        const key = normalizePath(diskFile.path);
        seenPaths.add(key);

        const existing = dbByPath.get(key);
        if (!existing) {
            const folderId = folderByPath.get(normalizePath(path.dirname(diskFile.path))) ?? null;
            const name = path.basename(diskFile.path);
            await db.execute(
                `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image, mtime)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name,
                    name,
                    folderId,
                    userId,
                    diskFile.path,
                    diskFile.size,
                    mime.lookup(diskFile.path) || 'application/octet-stream',
                    getExtension(diskFile.path),
                    isImage(diskFile.path) ? 1 : 0,
                    diskFile.mtime
                ]
            );
            inserted += 1;
        } else if (Number(existing.size) !== Number(diskFile.size)) {
            await db.execute(
                'UPDATE file_metadata SET size = ?, mtime = ?, updated_at = NOW() WHERE id = ?',
                [diskFile.size, diskFile.mtime, existing.id]
            );
            updated += 1;
        } else {
            // Size unchanged — keep mtime fresh but skip a heavier update.
            await db.execute(
                'UPDATE file_metadata SET mtime = ? WHERE id = ? AND (mtime IS NULL OR mtime <> ?)',
                [diskFile.mtime, existing.id, diskFile.mtime]
            );
        }
    }

    let deleted = 0;
    for (const [key, row] of dbByPath) {
        if (!seenPaths.has(key)) {
            await db.execute('DELETE FROM file_metadata WHERE id = ?', [row.id]);
            deleted += 1;
        }
    }

    await recalculateStorage(userId);
    return { inserted, updated, deleted };
}

/**
 * Reconcile every active user. Serialized so overlapping runs cannot stack.
 *
 * @returns {Promise<void>}
 */
async function reconcileAll() {
    if (running) {
        console.log('[reconcile] previous run still in progress, skipping');
        return;
    }
    running = true;
    const startedAt = Date.now();

    try {
        const db = getDatabase();
        const [users] = await db.execute('SELECT id FROM users WHERE is_active = 1');

        for (const user of users) {
            try {
                const result = await reconcileUser(user.id);
                if (result.inserted || result.updated || result.deleted) {
                    console.log(
                        `[reconcile] user ${user.id}: +${result.inserted} ~${result.updated} -${result.deleted}`
                    );
                }
            } catch (error) {
                console.error(`[reconcile] user ${user.id} failed:`, error.message);
            }
        }

        console.log(`[reconcile] completed in ${Date.now() - startedAt}ms`);
    } catch (error) {
        console.error('[reconcile] failed:', error);
    } finally {
        running = false;
    }
}

module.exports = {
    reconcileUser,
    reconcileAll
};
