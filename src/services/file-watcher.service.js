const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');
const mime = require('mime-types');
const { getDatabase } = require('../db/database');
const { getExtension, isImage } = require('../utils/helpers');
const { adjustUsedStorage } = require('./quota.service');

/**
 * Near-real-time watcher for files written outside the application (logs,
 * files copied directly into the storage directory, auto-generated files).
 *
 * It observes the upload root and keeps file_metadata + used_bytes in sync.
 * Handlers are idempotent: both the application and the watcher observe the
 * same on-disk change, so accounting is done by "set to observed value" and a
 * size delta, never by an unconditional increment. A change the application
 * already recorded therefore results in a no-op.
 *
 * A daily full reconcile (reconcile.service.js) corrects anything the watcher
 * misses (events dropped while the process was down, files outside inotify).
 */

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const debounceMs = parseInt(process.env.WATCHER_DEBOUNCE_MS || '1500', 10);
const ROOTS_CACHE_TTL_MS = 60 * 1000;

let watcher = null;
let rootsCache = { at: 0, roots: [] };
const pending = new Map();

function normalizePath(value) {
    return path.resolve(String(value || ''));
}

/**
 * Load (and briefly cache) the per-user storage roots.
 *
 * @returns {Promise<Array<{id:number, owner_id:number, path:string, norm:string}>>}
 */
async function getRoots() {
    const now = Date.now();
    if (rootsCache.roots.length > 0 && now - rootsCache.at < ROOTS_CACHE_TTL_MS) {
        return rootsCache.roots;
    }

    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id, owner_id, path FROM folders WHERE parent_id IS NULL AND path IS NOT NULL'
    );
    rootsCache = {
        at: now,
        roots: rows.map((row) => ({ ...row, norm: normalizePath(row.path) }))
    };
    return rootsCache.roots;
}

/**
 * Find the user root that owns a given absolute path (longest match).
 *
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
async function resolveRoot(filePath) {
    const norm = normalizePath(filePath);
    const roots = await getRoots();
    let best = null;

    for (const root of roots) {
        if (norm === root.norm) continue;
        if (norm.startsWith(root.norm + path.sep) && (!best || root.norm.length > best.norm.length)) {
            best = root;
        }
    }

    return best;
}

async function findFolderId(ownerId, directory) {
    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id FROM folders WHERE owner_id = ? AND path = ? LIMIT 1',
        [ownerId, directory]
    );
    return rows[0] ? rows[0].id : null;
}

/**
 * Handle a create/modify of a file: insert a new row or update the size delta.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function handleUpsert(filePath) {
    let stats;
    try {
        stats = await fsp.stat(filePath);
    } catch (error) {
        return; // vanished before we could process it
    }
    if (!stats.isFile()) return;

    const root = await resolveRoot(filePath);
    if (!root) return;

    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id, size FROM file_metadata WHERE owner_id = ? AND path = ? LIMIT 1',
        [root.owner_id, filePath]
    );
    const existing = rows[0];

    if (!existing) {
        const folderId = await findFolderId(root.owner_id, path.dirname(filePath));
        const name = path.basename(filePath);
        await db.execute(
            `INSERT INTO file_metadata (name, original_name, folder_id, owner_id, path, size, mime_type, extension, is_image, mtime)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                name,
                folderId,
                root.owner_id,
                filePath,
                stats.size,
                mime.lookup(filePath) || 'application/octet-stream',
                getExtension(filePath),
                isImage(filePath) ? 1 : 0,
                stats.mtime
            ]
        );
        await adjustUsedStorage(root.owner_id, stats.size);
    } else if (Number(existing.size) !== Number(stats.size)) {
        const delta = Number(stats.size) - Number(existing.size);
        await db.execute(
            'UPDATE file_metadata SET size = ?, mtime = ?, updated_at = NOW() WHERE id = ?',
            [stats.size, stats.mtime, existing.id]
        );
        await adjustUsedStorage(root.owner_id, delta);
    } else {
        await db.execute(
            'UPDATE file_metadata SET mtime = ? WHERE id = ? AND (mtime IS NULL OR mtime <> ?)',
            [stats.mtime, existing.id, stats.mtime]
        );
    }
}

/**
 * Handle a deletion: remove the row and subtract its size.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function handleRemove(filePath) {
    const root = await resolveRoot(filePath);
    if (!root) return;

    const db = getDatabase();
    const [rows] = await db.execute(
        'SELECT id, size FROM file_metadata WHERE owner_id = ? AND path = ? LIMIT 1',
        [root.owner_id, filePath]
    );
    const existing = rows[0];
    if (!existing) return;

    await db.execute('DELETE FROM file_metadata WHERE id = ?', [existing.id]);
    await adjustUsedStorage(root.owner_id, -Number(existing.size));
}

/**
 * Debounce per-path so bursts of change events (e.g. a growing log) collapse
 * into a single update. The last action for a path wins.
 *
 * @param {string} filePath
 * @param {'upsert'|'remove'} action
 */
function schedule(filePath, action) {
    const key = normalizePath(filePath);
    const prev = pending.get(key);
    if (prev && prev.timer) clearTimeout(prev.timer);

    const timer = setTimeout(() => {
        pending.delete(key);
        const handler = action === 'remove' ? handleRemove : handleUpsert;
        Promise.resolve(handler(filePath)).catch((error) => {
            console.error('[watcher] failed to process', filePath, error.message);
        });
    }, debounceMs);

    pending.set(key, { timer, action });
}

/**
 * Start watching the upload directory. Safe to call multiple times.
 */
function startWatcher() {
    if (watcher) return;

    const enabled = String(process.env.ENABLE_FILE_WATCHER || 'true').toLowerCase() !== 'false';
    if (!enabled) {
        console.log('[watcher] disabled via ENABLE_FILE_WATCHER');
        return;
    }

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    watcher = chokidar.watch(uploadDir, {
        ignoreInitial: true,
        persistent: true,
        depth: 20,
        awaitWriteFinish: false,
        ignored: /(^|[/\\])\../
    });

    watcher
        .on('add', (p) => schedule(p, 'upsert'))
        .on('change', (p) => schedule(p, 'upsert'))
        .on('unlink', (p) => schedule(p, 'remove'))
        .on('error', (error) => console.error('[watcher] error:', error.message));

    console.log(`[watcher] watching ${uploadDir}`);
}

/**
 * Stop the watcher and flush pending debounce timers. Safe to call when not started.
 *
 * @returns {Promise<void>}
 */
async function stopWatcher() {
    for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();

    if (watcher) {
        await watcher.close();
        watcher = null;
    }
}

module.exports = {
    startWatcher,
    stopWatcher,
    handleUpsert,
    handleRemove
};
