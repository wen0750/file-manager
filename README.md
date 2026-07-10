# File Manager

A full-featured web-based file manager with multi-user support, Docker deployment, and a comprehensive set of features.

## Features

- **Filesystem Quota** — Per-user storage quotas with real-time tracking
- **Database-Backed Config** — All settings stored in SQLite database
- **Upload Files** — Upload single or multiple files with drag & drop support, large file support
- **Download** — Download individual files or create ZIP archives for bulk downloads
- **Edit Files** — Built-in code editor (CodeMirror) with syntax highlighting for CSS, JS, HTML, TXT, JSON, Python, PHP, SQL, and more
- **Preview Files** — Preview images, videos, audio, PDFs, and text files without downloading
- **Manage Folders** — Create, rename, delete folders with easy directory navigation
- **Search Files** — Powerful search to find files and folders quickly
- **Copy & Move** — Copy or move files between folders with batch operations
- **Access Control** — Secure authentication with user management and permission controls
- **Multi-User Support** — Create multiple users with different access levels and folder permissions
- **Multi-Language** — Supports EN, ZH-HK, ZH-CN with easy translation system
- **Responsive Design** — Works on mobile, tablet, and desktop devices
- **Image Tools** — View image properties, thumbnails, and EXIF data
- **Secure** — CSRF protection, bcrypt password hashing, file upload validation, rate limiting

## Quick Start (Docker)

```bash
# Clone and build
docker compose up -d --build

# Access at http://localhost:3000
# Default login: admin / admin123
```

### Custom Configuration

Create a `.env` file or set environment variables:

```env
PORT=3000
SESSION_SECRET=your-random-secret-at-least-32-chars
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
DEFAULT_QUOTA=10737418240
MAX_FILE_SIZE=2147483648
```

Then run:

```bash
docker compose --env-file .env up -d --build
```

## Manual Setup

```bash
# Install dependencies
npm install

# Copy and edit environment config
cp .env.example .env
# Edit .env with your settings

# Initialize database (creates tables and default admin)
npm run init-db

# Start the server
npm start

# Or run in development mode
npm run dev
```

Access at `http://localhost:3000`

## Default Credentials

- **Username:** admin
- **Password:** admin123

**Change the admin password immediately after first login!**

## Architecture

```
file-manager/
├── src/
│   ├── server.js          # Entry point
│   ├── app.js             # Express app configuration
│   ├── db/
│   │   ├── database.js    # SQLite connection
│   │   ├── schema.sql     # Database schema
│   │   └── init.js        # DB initialization script
│   ├── middleware/
│   │   ├── auth.js        # Authentication & permissions
│   │   ├── csrf.js        # CSRF protection
│   │   ├── quota.js       # Storage quota checks
│   │   └── upload.js      # Multer file upload config
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── files.routes.js
│   │   ├── folders.routes.js
│   │   ├── users.routes.js
│   │   └── settings.routes.js
│   ├── services/
│   │   ├── file.service.js
│   │   ├── folder.service.js
│   │   ├── user.service.js
│   │   └── quota.service.js
│   └── utils/
│       ├── helpers.js     # Utility functions
│       └── i18n.js        # Internationalization
├── public/
│   ├── css/style.css      # All styles
│   ├── js/
│   │   ├── app.js         # Main application logic
│   │   ├── api.js         # API client
│   │   └── i18n.js        # Frontend i18n
│   ├── locales/
│   │   ├── en.json
│   │   ├── zh-CN.json
│   │   └── zh-HK.json
│   └── index.html
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (better-sqlite3)
- **Frontend:** Vanilla JS, CodeMirror, Font Awesome
- **Image Processing:** Sharp
- **File Uploads:** Multer
- **Security:** Helmet, CSRF, bcrypt, rate limiting

## API Endpoints

### Authentication
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Get current user
- `POST /api/auth/register` — Register (if enabled)
- `POST /api/auth/change-password` — Change password

### Files
- `GET /api/files` — List files (with `folder_id` or `search` params)
- `POST /api/files/upload` — Upload files (multipart/form-data)
- `GET /api/files/download/:id` — Download a file
- `POST /api/files/download-zip` — Download multiple files as ZIP
- `GET /api/files/preview/:id` — Stream file for preview
- `GET /api/files/thumbnail/:id` — Get image thumbnail
- `GET /api/files/info/:id` — Get file info (with image metadata)
- `GET /api/files/content/:id` — Get text file content
- `PUT /api/files/content/:id` — Update text file content
- `PUT /api/files/rename/:id` — Rename a file
- `POST /api/files/copy` — Copy files to folder
- `POST /api/files/move` — Move files to folder
- `DELETE /api/files/:id` — Delete a file
- `POST /api/files/batch-delete` — Delete multiple files

### Folders
- `GET /api/folders` — List folders or get tree
- `POST /api/folders` — Create folder
- `PUT /api/folders/:id` — Rename folder
- `DELETE /api/folders/:id` — Delete folder

### Users (admin)
- `GET /api/users` — List all users
- `POST /api/users` — Create user
- `PUT /api/users/:id` — Update user
- `DELETE /api/users/:id` — Delete user
- `GET /api/users/:id/quota` — Get user quota
- `GET /api/users/:id/permissions` — Get folder permissions
- `POST /api/users/:id/permissions` — Set folder permission
- `DELETE /api/users/:id/permissions/:folderId` — Remove permission

### Settings
- `GET /api/settings` — Get settings
- `PUT /api/settings` — Update settings (admin)
- `PUT /api/settings/language` — Set language preference

## Adding Translations

1. Create a new locale file in `public/locales/` (e.g., `fr.json`)
2. Copy the structure from `en.json` and translate values
3. Add the language code to `supportedLanguages` in `src/utils/i18n.js` and `public/js/i18n.js`
4. Add an option in the language selectors in `public/index.html`

## License

MIT
