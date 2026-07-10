const path = require('path');
const fs = require('fs');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
const TEXT_EXTENSIONS = ['.txt', '.log', '.csv', '.json', '.xml', '.yaml', '.yml', '.md', '.ini', '.conf', '.env'];
const EDITABLE_EXTENSIONS = ['.css', '.js', '.html', '.txt', '.json', '.xml', '.md', '.csv', '.yaml', '.yml', '.log', '.ini', '.conf', '.py', '.php', '.sql', '.sh', '.ts', '.jsx', '.tsx', '.vue'];

/**
 * Get file extension from filename.
 */
function getExtension(filename) {
    return path.extname(filename).toLowerCase();
}

/**
 * Check if a file is an image.
 */
function isImage(filename) {
    return IMAGE_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Check if a file is a video.
 */
function isVideo(filename) {
    return VIDEO_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Check if a file is audio.
 */
function isAudio(filename) {
    return AUDIO_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Check if a file is a PDF.
 */
function isPdf(filename) {
    return getExtension(filename) === '.pdf';
}

/**
 * Check if a file is text-based (previewable).
 */
function isText(filename) {
    return TEXT_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Check if a file can be edited in the code editor.
 */
function isEditable(filename) {
    return EDITABLE_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Check if a file is previewable (images, videos, audio, PDF, text).
 */
function isPreviewable(filename) {
    return isImage(filename) || isVideo(filename) || isAudio(filename) || isPdf(filename) || isText(filename);
}

/**
 * Get the CodeMirror mode for a given file extension.
 */
function getEditorMode(filename) {
    const ext = getExtension(filename);
    const modes = {
        '.css': 'css',
        '.js': 'javascript',
        '.html': 'htmlmixed',
        '.txt': 'text',
        '.json': 'application/json',
        '.xml': 'xml',
        '.md': 'markdown',
        '.csv': 'text',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.log': 'text',
        '.ini': 'properties',
        '.conf': 'properties',
        '.py': 'python',
        '.php': 'php',
        '.sql': 'sql',
        '.sh': 'shell',
        '.ts': 'text/typescript',
        '.jsx': 'text/jsx',
        '.tsx': 'text/jsx',
        '.vue': 'htmlmixed'
    };
    return modes[ext] || 'text';
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format date to readable string.
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'Z');
    return d.toLocaleString();
}

/**
 * Sanitize a filename to prevent directory traversal.
 */
function sanitizeFilename(name) {
    if (!name) return '';
    // Remove path traversal attempts
    name = name.replace(/\.\./g, '').replace(/\/+/g, '').replace(/\\+/g, '');
    // Remove dangerous characters
    name = name.replace(/[<>:"|?*\x00-\x1f]/g, '_');
    return name.trim();
}

/**
 * Generate a safe path for a file within the upload directory.
 */
function safeJoinPath(base, ...parts) {
    const joined = path.normalize(path.join(base, ...parts));
    if (!joined.startsWith(path.resolve(base))) {
        throw new Error('Path traversal detected');
    }
    return joined;
}

/**
 * Recursively get directory size.
 */
function getDirectorySize(dirPath) {
    let totalSize = 0;
    if (!fs.existsSync(dirPath)) return 0;

    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        if (stat.isFile()) {
            totalSize += stat.size;
        } else if (stat.isDirectory()) {
            totalSize += getDirectorySize(itemPath);
        }
    }
    return totalSize;
}

/**
 * Generate a random token.
 */
function generateToken(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

module.exports = {
    getExtension,
    isImage,
    isVideo,
    isAudio,
    isPdf,
    isText,
    isEditable,
    isPreviewable,
    getEditorMode,
    formatBytes,
    formatDate,
    sanitizeFilename,
    safeJoinPath,
    getDirectorySize,
    generateToken
};
