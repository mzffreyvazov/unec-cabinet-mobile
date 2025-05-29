// backend/server.js
import express from 'express';
import cors from 'cors';
import session from 'express-session';
// const FileStore = require('session-file-store')(session); // For persistent file store
import authRoutes from './routes/auth.js';
import academicRoutes from './routes/academic.js'; // Import academic routes
import path from 'path'; // Import path module
import { fileURLToPath } from 'url'; // To handle __dirname in ES modules

const app = express();
const PORT = process.env.PORT || 3001;

// ES module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({
    origin: ['http://127.0.0.1:5500', 'http://localhost:3001'], // Allow both for flexibility
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the frontend directory
// This should come before session middleware if session is not needed for static files
// or after if you want session available even for static file requests (less common).
// For simplicity, placing it here is fine.
app.use(express.static(path.join(__dirname, '../frontend')));


// Session Middleware - Place it BEFORE your routes that use sessions
app.use(session({
    secret: 'your_very_secret_key_for_session_encryption_12345', // CHANGE THIS!
    resave: false,
    saveUninitialized: false, // Changed to false - only save if session is modified
    cookie: {
        secure: false, // Set to true if your backend is HTTPS in production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        // store: new FileStore({ path: './sessions' }), // Example for file store
    }
}));

// Log session middleware activity
app.use((req, res, next) => {
    console.log(`SERVER_LOG: Request to ${req.method} ${req.originalUrl}`);
    console.log('SERVER_LOG: Incoming Cookies:', req.headers.cookie || 'None'); // Log raw cookie header
    console.log('SERVER_LOG: req.sessionID:', req.sessionID);
    console.log('SERVER_LOG: req.session.user:', req.session.user);
    console.log('SERVER_LOG: req.session.unecAuth exists:', !!req.session.unecAuth);
    if (req.session.unecAuth) {
        console.log('SERVER_LOG: req.session.unecAuth.cookieJarJson exists:', !!req.session.unecAuth.cookieJarJson);
    }
    next();
});

// Serve login.html specifically if root is requested, or let static middleware handle it.
// For example, to make http://localhost:3001/ show login.html:
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/academic', academicRoutes); // Use the academic routes

app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
});