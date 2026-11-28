const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { extractAndDiscardPDF } = require('../services/pdfService');
const { listHubDocuments, fetchDocumentText } = require('../services/mortaService');
const { buildShuffledDeck } = require('../utils/mathSampler');
const { generateQuestionsBatch, balanceQuestionAnswers } = require('../services/agentService');
const router = express.Router();

const MIN_QUESTIONS = 10;
const MAX_QUESTIONS = 15;
const BATCH_SIZE = 5;
const MAX_CONSECUTIVE_EMPTY_BATCHES = 3;

function getAllowlistPath() {
    if (process.env.ALLOWLIST_PATH) return process.env.ALLOWLIST_PATH;
    return process.env.RENDER
        ? '/etc/secrets/allowlist.json'
        : path.join(__dirname, '../utils/allowlist.json');
}

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

// Enforce minimum of 10 questions and maximum of 25
function clampQuestionCount(rawCount) {
    const parsed = parseInt(rawCount, 10) || MIN_QUESTIONS;
    return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, parsed));
}

function buildMockBatch(chunks, count, startIndex) {
    const questions = [];
    for (let i = 0; i < count; i++) {
        const chunk = chunks[i % chunks.length];
        const preview = chunk.replace(/\s+/g, ' ').slice(0, 80);
        questions.push({
            question: `[MOCK #${startIndex + i + 1}] Based on "${preview}...", what is the required ISO 19650 action?`,
            options: {
                A: 'Follow the defined CDE approval gate and suitability code.',
                B: 'Publish unverified WIP containers directly to the client.',
                C: 'Ignore the project BIM Execution Plan naming rules.',
                D: 'Track deliverables exclusively in local unshared folders.'
            },
            correctAnswer: 'A',
            explanation: `MOCK_AI mode active (0 LLM tokens used).\n\nSource chunk:\n${preview}...`
        });
    }
    return { questions, usage: null };
}

function initSSE(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    return (progress, status, data = null) => {
        if (res.writableEnded) return;
        try {
            res.write(`data: ${JSON.stringify({ progress, status, data })}\n\n`);
        } catch (err) {
            console.error('[SSE Write Error]:', err.message);
        }
    };
}

/**
 * Target-driven batch queue:
 * - Pass 1 draws fresh chunks from the full shuffled deck in batches of up to 5.
 * - Pass 2 recycles the richest chunks with compact avoid-stems if a short doc runs out.
 * - Circuit breakers cap total API calls and stop immediately if the client disconnects.
 */
async function runQuizGenerationPipeline(res, rawText, targetCount, sendUpdate) {
    let clientDisconnected = false;
    res.on('close', () => {
        if (!res.writableEnded) {
            clientDisconnected = true;
        }
    });

    const deck = buildShuffledDeck(rawText);
    if (deck.length === 0) {
        throw new Error('Document did not contain enough structured text to generate questions.');
    }

    sendUpdate(20, `Indexed ${deck.length} candidate sections. Generating ${targetCount} questions...`);

    const generatedQuestions = [];
    const seenQuestions = new Set();
    const richChunksForPass2 = [...deck]
        .filter(c => c.length >= 250)
        .sort((a, b) => b.length - a.length);

    // Hard token cap: e.g., target 10 -> max 6 batch calls (typically finishes in 2)
    const maxApiCalls = Math.min(Math.ceil(targetCount / 3) + 2, 8);
    const isMockMode = process.env.MOCK_AI === 'true';

    let cursor = 0;
    let pass2Cursor = 0;
    let apiCalls = 0;
    let consecutiveEmptyBatches = 0;

    while (
        !clientDisconnected &&
        generatedQuestions.length < targetCount &&
        apiCalls < maxApiCalls &&
        consecutiveEmptyBatches < MAX_CONSECUTIVE_EMPTY_BATCHES
    ) {
        const deficit = targetCount - generatedQuestions.length;
        const needed = Math.min(BATCH_SIZE, deficit);
        let batchChunks = [];
        let isPass2 = false;

        if (cursor < deck.length) {
            // Pass 1: draw needed chunks + 1 spare buffer chunk if available to absorb a NO_FACTS chunk without another API call
            const drawSize = Math.min(needed + 1, BATCH_SIZE + 1, deck.length - cursor);
            batchChunks = deck.slice(cursor, cursor + drawSize);
            cursor += drawSize;
        } else if (richChunksForPass2.length > 0) {
            // Pass 2 fallback for short documents: recycle longest chunks with exclusion stems
            isPass2 = true;
            const take = Math.min(needed, richChunksForPass2.length);
            for (let i = 0; i < take; i++) {
                batchChunks.push(richChunksForPass2[pass2Cursor % richChunksForPass2.length]);
                pass2Cursor++;
            }
        } else {
            break;
        }

        apiCalls++;

        try {
            const avoidQuestions = generatedQuestions.map(q => q.question);
            const result = isMockMode
                ? buildMockBatch(batchChunks, needed, generatedQuestions.length)
                : await generateQuestionsBatch(batchChunks, needed, { avoidQuestions });

            let addedThisBatch = 0;
            for (const q of result.questions || []) {
                const normalizedKey = q.question.toLowerCase().replace(/\s+/g, ' ').trim();
                if (seenQuestions.has(normalizedKey)) continue;

                seenQuestions.add(normalizedKey);
                generatedQuestions.push({
                    id: generatedQuestions.length + 1,
                    ...q
                });
                addedThisBatch++;

                if (generatedQuestions.length >= targetCount) break;
            }

            if (addedThisBatch === 0) {
                consecutiveEmptyBatches++;
                sendUpdate(
                    Math.min(95, 20 + Math.round((generatedQuestions.length / targetCount) * 75)),
                    `Sections lacked testable rules, drawing next batch... (${generatedQuestions.length} / ${targetCount} ready)`
                );
            } else {
                consecutiveEmptyBatches = 0;
                const progress = Math.min(95, 20 + Math.round((generatedQuestions.length / targetCount) * 75));
                const passNote = isPass2 ? ' (deepening coverage)' : '';
                sendUpdate(
                    progress,
                    `Prepared ${generatedQuestions.length} of ${targetCount} questions${passNote}...`
                );
            }
        } catch (batchError) {
            console.warn(`[AI Batch Warning] Call ${apiCalls} failed:`, batchError.message);
            consecutiveEmptyBatches++;
            sendUpdate(
                Math.min(95, 20 + Math.round((generatedQuestions.length / targetCount) * 75)),
                `Retrying with next document batch... (${generatedQuestions.length} / ${targetCount} ready)`
            );
        }
    }

    if (clientDisconnected) {
        console.log('[SSE] Client disconnected early. Halted AI generation to save tokens.');
        return;
    }

    if (generatedQuestions.length === 0) {
        throw new Error('Could not extract valid quiz questions from this document.');
    }

    const balancedQuestions = balanceQuestionAnswers(generatedQuestions).map((q, index) => ({
        ...q,
        id: index + 1
    }));

    sendUpdate(100, 'COMPLETE', balancedQuestions);
    res.end();
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
        sendUpdate(15, `Loaded "${documentName}" from Morta. Indexing content...`);

        const targetCount = clampQuestionCount(questionCount);
        await runQuizGenerationPipeline(res, rawText, targetCount, sendUpdate);
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
        sendUpdate(15, 'Text extracted. Indexing document...');

        const targetCount = clampQuestionCount(req.body.questionCount);
        await runQuizGenerationPipeline(res, rawText, targetCount, sendUpdate);
    } catch (error) {
        console.error('[Generation Route Error]:', error.message);
        sendUpdate(0, 'ERROR', { message: error.message });
        res.end();
    }
});

module.exports = router;