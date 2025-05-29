// backend/routes/auth.js
import express from 'express';
import unecClient from '../services/unecClient.js';
// We will need CookieJar to deserialize later, but not for storing here directly
// import { CookieJar } from 'tough-cookie';

const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        console.log('AUTH_ROUTE: /login called for user:', username);
        const { csrfToken, cookieJar: initialCookieJar } = await unecClient.getLoginPageAndCsrf();
        console.log('AUTH_ROUTE: Got CSRF:', csrfToken, "and initial cookie jar.");

        const loginResult = await unecClient.submitLogin(username, password, csrfToken, initialCookieJar);
        console.log('AUTH_ROUTE: UNEC login submission result from unecClient:', JSON.stringify(loginResult));

        if (loginResult && loginResult.success && loginResult.authenticatedCookieJar) {
            // ---- SESSION MANAGEMENT START ----
            // Store the serialized UNEC cookie jar in our app's session
            // The `tough-cookie` jar has a serializeSync method.
            try {
                const serializedJar = loginResult.authenticatedCookieJar.serializeSync();
                req.session.unecAuth = {
                    cookieJarJson: serializedJar // Store the JSON representation
                };
                req.session.user = { username: username }; // Identify the app user

                // Manually save the session if your store requires it or to be explicit
                req.session.save(err => {
                    if (err) {
                        console.error('AUTH_ROUTE: Session save error:', err);
                        return res.status(500).json({ success: false, message: 'Failed to save session after UNEC login.' });
                    }
                    console.log('AUTH_ROUTE: UNEC auth data stored in app session for user:', username);
                    res.json({
                        success: true,
                        message: 'Login successful. App session established.'
                    });
                });
            } catch (serializationError) {
                console.error('AUTH_ROUTE: Error serializing cookie jar:', serializationError);
                res.status(500).json({ success: false, message: 'Failed to process UNEC session for app session storage.' });
            }
            // ---- SESSION MANAGEMENT END ----
        } else {
            console.warn('AUTH_ROUTE: UNEC login reported as failed by unecClient or missing cookie jar.');
            res.status(401).json({ success: false, message: loginResult?.message || 'UNEC login credentials incorrect or other login failure.' });
        }
    } catch (error) {
        console.error('AUTH_ROUTE: Critical error in login process:', error.message);
        const errorMessage = (error && typeof error.message === 'string') ? error.message : 'An unexpected internal error occurred during login.';
        res.status(500).json({ success: false, message: errorMessage });
    }
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