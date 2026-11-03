require('dotenv').config();
const express = require('express');
const cors = require('cors');
const generateRoutes = require('./routes/generateRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

const path = require('path');

// Tell Express to serve all files from your 'client' directory
app.use(express.static(path.join(__dirname, '../client')));

// Catch-all route to serve your main HTML file when users hit the root URL
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Middleware
// CORS is required because your frontend and backend will run on different local ports during testing
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount the upload and generation pipeline
app.use('/', generateRoutes);

// Global Error Catcher
app.use((err, req, res, next) => {
    console.error('[Server Error]:', err.message);
    res.status(500).json({ status: 'ERROR', message: 'Internal Server Error' });
});

// Boot the server
app.listen(PORT, () => {
    console.log(`BIM Manager Trivia API running on http://localhost:${PORT}`);
});