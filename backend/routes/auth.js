// backend/routes/auth.js
import express from 'express';
import unecClient from '../services/unecClient.js';
// We will need CookieJar to deserialize later, but not for storing here directly
// import { CookieJar } from 'tough-cookie';

const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    // ... (validation) ...
    try {
        // No separate getLoginPageAndCsrf needed if Puppeteer handles it all
        const loginResult = await unecClient.submitLogin(username, password); // Puppeteer version

        if (loginResult.success && loginResult.authenticatedCookieJar) {
            // Store loginResult.authenticatedCookieJar.serializeSync() in session
            // ... (session management as before) ...
            res.json({ success: true, message: loginResult.message });
        } else {
            res.status(401).json({ success: false, message: loginResult.message || 'UNEC login failed via Puppeteer.' });
        }
    } catch (error) { /* ... */ }
});

// Add a simple endpoint to check session status
router.get('/session-check', (req, res) => {
    if (req.session && req.session.user && req.session.unecAuth) {
        res.json({
            success: true,
            message: 'User is authenticated with the app.',
            user: req.session.user,
            hasUnecAuth: req.session.unecAuth.cookieJarJson ? "Yes (serialized)" : "No"
        });
    } else {
        res.status(401).json({ success: false, message: 'User not authenticated with the app.' });
    }
});

// Add a logout endpoint for your app
router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('AUTH_ROUTE: Error destroying session:', err);
            return res.status(500).json({ success: false, message: 'Failed to log out.' });
        }
        // Optional: Clear the cookie on the client side as well, though destroying session should be enough
        res.clearCookie('connect.sid'); // Default cookie name for express-session, check your config
        console.log('AUTH_ROUTE: Session destroyed, user logged out.');
        res.json({ success: true, message: 'Logged out successfully.' });
    });
});


export default router;