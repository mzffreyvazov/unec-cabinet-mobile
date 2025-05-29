// backend/routes/auth.js
import express from 'express';
import unecClient from '../services/unecClient.js'; // Make sure path and .js are correct

const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        console.log('AUTH_ROUTE: /login called for user:', username);
        const { csrfToken, cookieJar: initialCookieJar } = await unecClient.getLoginPageAndCsrf();
        console.log('AUTH_ROUTE: Got CSRF and initial jar.');

        const loginResult = await unecClient.submitLogin(username, password, csrfToken, initialCookieJar);
        console.log('AUTH_ROUTE: UNEC login submission result success from unecClient:', loginResult.success); // Log the actual success value

        if (loginResult.success && loginResult.authenticatedCookieJar) { // Check for authenticatedCookieJar too
            console.log('AUTH_ROUTE: UNEC Login successful. Proceeding to session management (TODO).');
            // TODO: IMPORTANT! Securely manage the session.
            // This is where you would interact with your sessionManager.js
            // For now, we are just sending success.

            // const cookiesForClient = await loginResult.authenticatedCookieJar.getCookies(BASE_URL); // BASE_URL needs to be accessible or passed
            // console.log('AUTH_ROUTE: Authenticated UNEC cookies (for potential server-side storage):', cookiesForClient.map(c => c.cookieString()));

            res.json({
                success: true,
                message: 'Proxy login to UNEC deemed successful by unecClient.'
                // DO NOT send UNEC cookies to client in production without encryption/session ID
            });
        } else {
            console.warn('AUTH_ROUTE: UNEC login reported as failed by unecClient or missing cookie jar.');
            res.status(401).json({ success: false, message: loginResult.message || 'UNEC login failed as reported by client.' });
        }
    } catch (error) { // This is where your error is being caught
        console.error('AUTH_ROUTE: Login process error:', error.message); // This is logged
        console.error('AUTH_ROUTE: Error stack:', error.stack ? error.stack.split('\n').slice(0,5).join('\n') : "No stack");
        res.status(500).json({ success: false, message: error.message || 'An internal error occurred during login.' });
    }
});

export default router;