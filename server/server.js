require('dotenv').config();
const express = require('express');
const cors = require('cors');
const generateRoutes = require('./routes/generateRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

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