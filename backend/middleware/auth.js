// backend/middleware/auth.js
export default function appAuthMiddleware(req, res, next) {
    if (req.session && req.session.user && req.session.unecAuth && req.session.unecAuth.cookieJarJson) {
        console.log('MIDDLEWARE_AUTH: Access granted for user:', req.session.user.username);
        return next(); // User is authenticated with the app and has UNEC auth data
    } else {
        console.warn('MIDDLEWARE_AUTH: Unauthorized access attempt.');
        if (!req.session || !req.session.user) {
            console.warn('MIDDLEWARE_AUTH: Reason: App session or user data missing.');
        } else if (!req.session.unecAuth || !req.session.unecAuth.cookieJarJson) {
            console.warn('MIDDLEWARE_AUTH: Reason: UNEC auth data (cookieJarJson) missing from session.');
        }
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in again.' });
    }
}