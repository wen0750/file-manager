const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');
const { getSetting } = require('../db/database');

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = userService.verifyPassword(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            language: user.language
        }
    });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

/**
 * GET /api/auth/me
 */
router.get('/me', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = userService.getUserById(req.session.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user });
});

/**
 * POST /api/auth/register
 */
router.post('/register', (req, res) => {
    const allowRegistration = getSetting('allow_registration', '0') === '1';
    if (!allowRegistration) {
        return res.status(403).json({ error: 'Registration is disabled' });
    }

    const { username, password, email, language } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        const user = userService.createUser(username, password, email, 'user', null, language || 'en');
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ success: true, user });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

/**
 * POST /api/auth/change-password
 */
router.post('/change-password', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = userService.verifyPassword(req.session.username, currentPassword);
    if (!user) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    userService.updateUser(req.session.userId, { password: newPassword });
    res.json({ success: true });
});

module.exports = router;
