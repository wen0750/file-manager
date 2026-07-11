const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { getDatabase } = require('./db/database');
const { loadUser } = require('./middleware/auth');
const { csrfProtection, csrfToken } = require('./middleware/csrf');

const app = express();

const trustProxyValue = process.env.TRUST_PROXY ?? "1";

if (trustProxyValue !== "") {
  const parsedTrustProxy = Number(trustProxyValue);
  app.set(
    "trust proxy",
    Number.isNaN(parsedTrustProxy) ? trustProxyValue : parsedTrustProxy
  );
}

// Ensure upload directory exists
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Initialize database pool (creates the MySQL connection pool)
getDatabase();

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdnjs.cloudflare.com',
                'https://cdn.jsdelivr.net'
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdnjs.cloudflare.com',
                'https://cdn.jsdelivr.net'
            ],
            imgSrc: ["'self'", 'data:', 'blob:'],
            mediaSrc: ["'self'", 'blob:', 'data:'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'data:']
        }
    },
    crossdomain: true
}));

// Logging
app.use(morgan('combined'));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookies
app.use(cookieParser());

// Session
app.use(session({
    name: 'connect.sid',
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // Set to true when behind HTTPS reverse proxy
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
}));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Load user info for all requests
app.use(loadUser);

// CSRF token for views
app.use(csrfToken);

// Routes - auth routes don't need CSRF
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/files', require('./routes/files.routes'));
app.use('/api/folders', require('./routes/folders.routes'));
app.use('/api/users', require('./routes/users.routes'));
app.use('/api/settings', require('./routes/settings.routes'));

// CSRF protection for non-GET requests to non-API routes
app.use(csrfProtection);

// Page routes
app.get('/login', (req, res) => {
    if (req.session && req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/', (req, res) => {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'CSRF token mismatch', code: 'CSRF_ERROR' });
    }

    // Multer errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large', code: 'FILE_TOO_LARGE' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files', code: 'TOO_MANY_FILES' });
    }

    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
