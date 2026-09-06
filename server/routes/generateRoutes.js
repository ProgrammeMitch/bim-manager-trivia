const express = require('express');
const multer = require('multer');
const { extractAndDiscardPDF } = require('../services/pdfService');
const { sampleChunks } = require('../utils/mathSampler');
const { generateQuestionFromChunk } = require('../services/agentService');
const router = express.Router();

// Configure Multer for temporary storage
const upload = multer({ dest: 'temp_uploads/' });

router.post('/upload-and-generate', upload.single('document'), async (req, res) => {
    // 1. Establish SSE Connection
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = (progress, status, data = null) => {
        try {
            res.write(`data: ${JSON.stringify({ progress, status, data })}\n\n`);
        } catch (err) {
            console.error("[SSE Write Error]:", err.message);
        }
    };

    try {
        if (!req.file) {
            throw new Error("No PDF file provided.");
        }

        sendUpdate(5, "Extracting text from PDF...");

        // 2. Extract and discard
        const rawText = await extractAndDiscardPDF(req.file.path);
        sendUpdate(15, "Text extracted. Chunking document...");

        // 3. Algorithmic sampling
        const requestedQuestions = parseInt(req.body.questionCount) || 20;
        const textChunks = sampleChunks(rawText, requestedQuestions);

        sendUpdate(25, `Document segmented into ${textChunks.length} high-density chunks. Booting AI agent...`);

        // 4. AI Generation Loop (Simulated here; OpenAI integration plugs in directly here)
        const generatedQuestions = [];
        const progressStep = 70 / textChunks.length; // Remaining 70% divided by chunks
        let currentProgress = 25;

        for (let i = 0; i < textChunks.length; i++) {
            try {
                // The live API Call
                const aiResponse = await generateQuestionFromChunk(textChunks[i]);

                // Only save it if the AI found facts and built a question
                if (aiResponse && aiResponse.status !== "NO_FACTS" && aiResponse.question) {
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
                // Loop continues to the next chunk even if this one fails
            }
        }

        // 5. Final payload delivery
        sendUpdate(100, "COMPLETE", generatedQuestions);
        res.end();

    } catch (error) {
        console.error("[Generation Route Error]:", error.message);
        sendUpdate(0, "ERROR", { message: error.message });
        res.end();
    }
});

module.exports = router;