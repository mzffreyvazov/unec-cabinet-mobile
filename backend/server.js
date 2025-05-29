// backend/server.js
import express from 'express';
import cors from 'cors'; // For allowing requests from your frontend development server
import authRoutes from './routes/auth.js';
// import academicRoutes from './routes/academic.js'; // We'll add this later

const app = express();
const PORT = process.env.PORT || 3001; // Backend port

app.use(cors({ // Configure CORS appropriately for development and production
    origin: 'http://localhost:5500', // Or your frontend dev server URL, or '*' for open dev
    credentials: true // If you plan to use cookies for your app's session
}));
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Middleware for x-www-form-urlencoded

// TODO: Add session middleware here (e.g., express-session) for your app's own session management

app.use('/api/auth', authRoutes);
// app.use('/api/academic', academicRoutes); // Later

app.get('/', (req, res) => {
    res.send('UNEC Data Proxy Backend is running!');
});

app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});