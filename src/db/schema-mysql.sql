-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    quota_bytes BIGINT NOT NULL DEFAULT 10737418240,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- Folders table (virtual folder structure with permissions)
CREATE TABLE IF NOT EXISTS folders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id INT,
    owner_id INT NOT NULL,
    path VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- File metadata table
CREATE TABLE IF NOT EXISTS file_metadata (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    folder_id INT,
    owner_id INT NOT NULL,
    path VARCHAR(1000) NOT NULL,
    size BIGINT NOT NULL,
    mime_type VARCHAR(255),
    extension VARCHAR(20),
    is_image TINYINT(1) NOT NULL DEFAULT 0,
    mtime DATETIME NULL,
    width INT,
    height INT,
    exif_data LONGTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- Folder permissions table (for multi-user access)
CREATE TABLE IF NOT EXISTS folder_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folder_id INT NOT NULL,
    user_id INT NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'read' CHECK(permission IN ('read', 'write', 'admin')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(folder_id, user_id),
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- Application settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    `key` VARCHAR(255) PRIMARY KEY,
    value TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- File share links table
CREATE TABLE IF NOT EXISTS share_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    file_id INT,
    folder_id INT,
    owner_id INT NOT NULL,
    expires_at DATETIME,
    max_downloads INT,
    download_count INT NOT NULL DEFAULT 0,
    password_hash VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES file_metadata(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- Activity log table
CREATE TABLE IF NOT EXISTS activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    details VARCHAR(1000),
    ip_address VARCHAR(45),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
);

-- Indexes for performance
CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX idx_folders_owner ON folders(owner_id);
CREATE INDEX idx_folders_path ON folders(path);
CREATE INDEX idx_files_folder ON file_metadata(folder_id);
CREATE INDEX idx_files_owner ON file_metadata(owner_id);
CREATE INDEX idx_files_path ON file_metadata(path);
CREATE INDEX idx_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_permissions_user ON folder_permissions(user_id);
CREATE INDEX idx_activity_user ON activity_log(user_id);
CREATE INDEX idx_share_token ON share_links(token);

-- Default settings
INSERT IGNORE INTO settings (`key`, value) VALUES ('app_name', 'File Manager');
INSERT IGNORE INTO settings (`key`, value) VALUES ('default_language', 'en');
INSERT IGNORE INTO settings (`key`, value) VALUES ('default_quota', '10737418240');
INSERT IGNORE INTO settings (`key`, value) VALUES ('allow_registration', '0');
INSERT IGNORE INTO settings (`key`, value) VALUES ('max_file_size', '2147483648');
INSERT IGNORE INTO settings (`key`, value) VALUES ('allowed_extensions', '');
