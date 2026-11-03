require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // Make sure path is required
const generateRoutes = require('./routes/generateRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Serve static files from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// 2. Explicitly serve index.html on the root URL (This replaces the broken '*' wildcard)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

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