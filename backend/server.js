// backend/server.js
import express from 'express';
import cors from 'cors';
import session from 'express-session';
// const FileStore = require('session-file-store')(session); // For persistent file store
import authRoutes from './routes/auth.js';
import academicRoutes from './routes/academic.js'; // Import academic routes

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: 'http://127.0.0.1:5500', // Your frontend origin
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    console.log('SERVER: Session ID:', req.sessionID);
    console.log('SERVER: Session user:', req.session.user);
    next();
});

app.use('/api/auth', authRoutes);
app.use('/api/academic', academicRoutes); // Use the academic routes

app.get('/', (req, res) => {
    res.send('UNEC Data Proxy Backend is running!');
});

app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
});