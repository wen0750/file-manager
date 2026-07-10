/**
 * CSRF protection middleware setup.
 * Provides csrfToken to views and validates on POST/PUT/DELETE.
 */
const csrf = require('csurf');

const csrfProtection = csrf({ cookie: true });

/**
 * API-friendly CSRF: skip for API routes that use token auth.
 */
function apiCsrf(req, res, next) {
    // Skip CSRF for login/register endpoints (they have their own protection)
    const skipPaths = ['/api/auth/login', '/api/auth/register', '/login', '/register'];
    if (skipPaths.includes(req.path)) {
        return next();
    }
    return csrfProtection(req, res, next);
}

/**
 * Provide CSRF token to all views.
 */
function csrfToken(req, res, next) {
    if (typeof req.csrfToken === 'function') {
        res.locals.csrfToken = req.csrfToken();
    } else {
        res.locals.csrfToken = '';
    }
    next();
}

module.exports = {
    csrfProtection,
    apiCsrf,
    csrfToken
};
