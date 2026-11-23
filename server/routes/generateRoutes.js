const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { extractAndDiscardPDF } = require('../services/pdfService');
const { listHubDocuments, fetchDocumentText } = require('../services/mortaService');
const { sampleChunks } = require('../utils/mathSampler');
const { generateQuestionFromChunk } = require('../services/agentService');
const router = express.Router();

// Resolve allowlist path (supports ALLOWLIST_PATH override for automated tests)
function getAllowlistPath() {
    if (process.env.ALLOWLIST_PATH) return process.env.ALLOWLIST_PATH;
    return process.env.RENDER
        ? '/etc/secrets/allowlist.json'
        : path.join(__dirname, '../utils/allowlist.json');
}

// Middleware to check if the email is allowed
function verifyBetaAccess(req, res, next) {
    const userEmail = req.headers['x-user-email'];

    if (!userEmail) {
        return res.status(403).json({ error: 'Access denied: No beta email provided.' });
    }

    try {
        const rawData = fs.readFileSync(getAllowlistPath(), 'utf8');
        const allowedEmails = JSON.parse(rawData);

        if (allowedEmails.includes(userEmail.toLowerCase().trim())) {
            next();
        } else {
            return res.status(403).json({ error: 'Access denied: Email not on the active beta list or has expired.' });
        }
    } catch (error) {
        console.error('Error reading allowlist.json:', error);
        return res.status(500).json({ error: 'Server error verifying access.' });
    }
}

// Helper: clamp requested chunks between 5 and 25
function clampQuestionCount(rawCount) {
    const parsed = parseInt(rawCount, 10) || 10;
    return Math.min(25, Math.max(5, parsed));
}

// Helper: zero-token mock question for local UI testing when MOCK_AI=true
function buildMockQuestion(chunk, index) {
    const preview = chunk.replace(/\s+/g, ' ').slice(0, 90);
    return {
        question: `[MOCK #${index + 1}] Based on the extracted guidance ("${preview}..."), which compliance action is required?`,
        options: {
            A: 'Follow the structured ISO 19650 approval gate and metadata protocol.',
            B: 'Upload unverified WIP files directly to the Published state.',
            C: 'Bypass the BIM Execution Plan naming convention.',
            D: 'Store project deliverables exclusively on local desktop folders.'
        },
        correctAnswer: 'A',
        explanation: `MOCK_AI mode is active (0 LLM tokens used).\n\nSource chunk preview:\n${preview}...`
    };
}

// Shared SSE streaming pipeline for both PDF and Morta sources
async function runQuizGenerationPipeline(res, rawText, requestedQuestions, sendUpdate) {
    const textChunks = sampleChunks(rawText, requestedQuestions);

    if (textChunks.length === 0) {
        throw new Error('Document did not contain enough structured text to generate questions.');
    }

    sendUpdate(25, `Document segmented into ${textChunks.length} high-density chunks. Booting AI agent...`);

    const generatedQuestions = [];
    const progressStep = 70 / textChunks.length;
    let currentProgress = 25;
    const isMockMode = process.env.MOCK_AI === 'true';

    for (let i = 0; i < textChunks.length; i++) {
        try {
            const aiResponse = isMockMode
                ? buildMockQuestion(textChunks[i], i)
                : await generateQuestionFromChunk(textChunks[i]);

            if (aiResponse && aiResponse.status !== 'NO_FACTS' && aiResponse.question) {
                generatedQuestions.push({
                    id: generatedQuestions.length + 1,
                    ...aiResponse
                });
            }

            currentProgress += progressStep;
            sendUpdate(
                Math.round(currentProgress),
                `Analyzed chunk ${i + 1} of ${textChunks.length}. Found ${generatedQuestions.length} valid questions...`
            );
        } catch (chunkError) {
            console.warn(`[AI Generation Warning] Chunk ${i} failed:`, chunkError.message);
            currentProgress += progressStep;
            sendUpdate(
                Math.round(currentProgress),
                `Skipped chunk ${i + 1} due to extraction error...`
            );
        }
    }

    sendUpdate(100, 'COMPLETE', generatedQuestions);
    res.end();
}

function initSSE(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    return (progress, status, data = null) => {
        try {
            res.write(`data: ${JSON.stringify({ progress, status, data })}\n\n`);
        } catch (err) {
            console.error('[SSE Write Error]:', err.message);
        }
    };
}

// 1. List Morta IMI Framework guidance documents for the sidebar
router.get('/api/morta/documents', async (req, res) => {
    try {
        const documents = await listHubDocuments();
        res.json({ documents });
    } catch (error) {
        console.error('[Morta List Route Error]:', error.message);
        res.status(502).json({ error: 'Unable to fetch Morta guidance list.' });
    }
});

// 2. Generate quiz directly from a live Morta document
router.post('/generate-from-morta', express.json(), verifyBetaAccess, async (req, res) => {
    const sendUpdate = initSSE(res);

    try {
        const { documentId, questionCount } = req.body || {};
        if (!documentId) {
            throw new Error('No Morta guidance document selected.');
        }

        sendUpdate(5, 'Connecting to Morta API...');

        const { documentName, rawText } = await fetchDocumentText(documentId);
        sendUpdate(15, `Loaded "${documentName}" from Morta. Chunking content...`);

        const requestedQuestions = clampQuestionCount(questionCount);
        await runQuizGenerationPipeline(res, rawText, requestedQuestions, sendUpdate);
    } catch (error) {
        console.error('[Morta Generation Route Error]:', error.message);
        sendUpdate(0, 'ERROR', { message: error.message });
        res.end();
    }
});

// 3. Existing PDF upload pipeline
const upload = multer({ dest: 'temp_uploads/' });

router.post('/upload-and-generate', verifyBetaAccess, upload.single('document'), async (req, res) => {
    const sendUpdate = initSSE(res);

    try {
        if (!req.file) {
            throw new Error('No PDF file provided.');
        }

        sendUpdate(5, 'Extracting text from PDF...');

        const rawText = await extractAndDiscardPDF(req.file.path);
        sendUpdate(15, 'Text extracted. Chunking document...');

        const requestedQuestions = clampQuestionCount(req.body.questionCount);
        await runQuizGenerationPipeline(res, rawText, requestedQuestions, sendUpdate);
    } catch (error) {
        console.error('[Generation Route Error]:', error.message);
        sendUpdate(0, 'ERROR', { message: error.message });
        res.end();
    }
});

module.exports = router;