// backend/server.js
import express from 'express';
import cors from 'cors';
import session from 'express-session'; // Import express-session
import authRoutes from './routes/auth.js';
// import academicRoutes from './routes/academic.js'; // We'll enable this soon

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: 'http://127.0.0.1:5500', // Or your frontend's actual dev origin for live server
    credentials: true // IMPORTANT: Allow frontend to send/receive cookies for session
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Middleware Configuration
app.use(session({
    secret: 'your_very_secret_key_for_session_encryption', // Change this to a long random string!
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    cookie: {
        secure: process.env.NODE_ENV === 'production', // True if using HTTPS in production
        httpOnly: true, // Prevents client-side JS from accessing the cookie
        maxAge: 24 * 60 * 60 * 1000 // Session cookie valid for 1 day (e.g.)
        // sameSite: 'lax' // Consider 'lax' or 'strict' for CSRF protection
    }
    // store: new FileStore() // Example for persistent store (npm install session-file-store)
                           // For now, default MemoryStore is fine for dev
}));

app.use('/api/auth', authRoutes);
// app.use('/api/academic', academicRoutes);

app.get('/', (req, res) => {
    res.send('UNEC Data Proxy Backend is running! Session support added.');
});

app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
});