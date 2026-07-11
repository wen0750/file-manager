const fs = require('fs');
const path = require('path');

function sanitizeFilename(filename) {
    const baseName = path.basename(String(filename || ''));
    const cleaned = baseName
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim();

    return cleaned || 'unnamed';
}

function safeJoinPath(basePath, ...segments) {
    const normalizedBasePath = path.resolve(String(basePath || '.'));
    const cleanedSegments = segments.map((segment) => String(segment || ''));
    const targetPath = path.resolve(normalizedBasePath, ...cleanedSegments);
    const normalizedBaseWithSep = normalizedBasePath.endsWith(path.sep)
        ? normalizedBasePath
        : `${normalizedBasePath}${path.sep}`;

    if (targetPath !== normalizedBasePath && !targetPath.startsWith(normalizedBaseWithSep)) {
        throw new Error('Path traversal detected');
    }

    return targetPath;
}

function getExtension(filename) {
    return path.extname(String(filename || '')).toLowerCase();
}

function isImage(filename) {
    const extension = getExtension(filename);
    return new Set([
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.bmp',
        '.svg',
        '.ico',
        '.tif',
        '.tiff',
        '.avif'
    ]).has(extension);
}

function getDirectorySize(directoryPath) {
    if (!directoryPath || !fs.existsSync(directoryPath)) {
        return 0;
    }

    const stat = fs.statSync(directoryPath);
    if (!stat.isDirectory()) {
        return stat.size;
    }

    return fs.readdirSync(directoryPath).reduce((total, entry) => {
        const entryPath = path.join(directoryPath, entry);
        return total + getDirectorySize(entryPath);
    }, 0);
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value === 0) {
        return '0 Bytes';
    }

    const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(
        Math.floor(Math.log(value) / Math.log(1024)),
        units.length - 1
    );
    const formatted = value / Math.pow(1024, index);

    return `${formatted.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

module.exports = {
    sanitizeFilename,
    safeJoinPath,
    getExtension,
    isImage,
    getDirectorySize,
    formatBytes
};
