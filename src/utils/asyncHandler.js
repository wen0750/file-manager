/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to Express's error handler via next(err).
 *
 * @param {Function} fn - Async route handler (req, res, next)
 * @returns {Function} Express middleware function
 */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
