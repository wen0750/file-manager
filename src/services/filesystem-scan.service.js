const fs = require('fs/promises');
const path = require('path');

function isFilesystemScanEnabled() {
    return String(process.env.ALLOW_FILESYSTEM_SCAN_FOR_MISSING_DB_FILES || '').toLowerCase() === 'true';
}

function normalizePath(value) {
    if (!value) {
        return '';
    }

    return path.resolve(String(value)).toLowerCase();
}

function getDatabaseFileKey(file) {
    return normalizePath(file?.path || file?.absolute_path);
}

async function collectFilesystemFiles(directoryPath, folderId = null) {
    if (!directoryPath) {
        return [];
    }

    let entries;
    try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        return [];
    }

    const results = [];

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        const fullPath = path.join(directoryPath, entry.name);
        const stats = await fs.stat(fullPath);

        results.push({
            id: null,
            name: entry.name,
            original_name: entry.name,
            folder_id: folderId,
            size: stats.size,
            mime_type: null,
            extension: path.extname(entry.name),
            is_image: null,
            width: null,
            height: null,
            path: fullPath,
            absolute_path: fullPath,
            created_at: stats.birthtime || stats.ctime,
            updated_at: stats.mtime,
            inDatabase: false,
            source: 'filesystem'
        });
    }

    return results;
}

async function mergeFilesystemOnlyFiles(dbFiles, directoryPath, folderId = null) {
    const databaseFiles = Array.isArray(dbFiles) ? dbFiles : [];

    if (!isFilesystemScanEnabled() || !directoryPath) {
        return databaseFiles.map((file) => ({
            ...file,
            inDatabase: file?.inDatabase !== false,
            source: file?.source || 'database'
        }));
    }

    const dbKeys = new Set(databaseFiles.map((file) => getDatabaseFileKey(file)).filter(Boolean));
    const filesystemFiles = await collectFilesystemFiles(directoryPath, folderId);
    const missingDbFiles = filesystemFiles.filter((file) => !dbKeys.has(getDatabaseFileKey(file)));

    return [
        ...databaseFiles.map((file) => ({
            ...file,
            inDatabase: file?.inDatabase !== false,
            source: file?.source || 'database'
        })),
        ...missingDbFiles
    ];
}

module.exports = {
    collectFilesystemFiles,
    isFilesystemScanEnabled,
    mergeFilesystemOnlyFiles
};
