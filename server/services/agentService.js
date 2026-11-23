const { OpenAI } = require('openai');
const { getBIMManagerPrompt } = require('../utils/prompts');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let cachedClient = null;
function getOpenAIClient() {
    if (!cachedClient) {
        cachedClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return cachedClient;
}

function isValidQuestionItem(item) {
    return Boolean(
        item &&
        item.status !== 'NO_FACTS' &&
        typeof item.question === 'string' &&
        item.question.trim().length > 0 &&
        item.options &&
        typeof item.options === 'object' &&
        item.options.A &&
        item.options.B &&
        item.options.C &&
        item.options.D &&
        typeof item.correctAnswer === 'string' &&
        typeof item.explanation === 'string'
    );
}

/**
 * Token-efficient batch generator: sends several chunks at once so the system prompt
 * is only paid once per batch instead of once per question.
 */
async function generateQuestionsBatch(chunks, count, options = {}) {
    const {
        avoidQuestions = [],
        model = DEFAULT_MODEL,
        client = null
    } = options;

    if (!Array.isArray(chunks) || chunks.length === 0 || count <= 0) {
        return { questions: [], usage: null };
    }

    const openai = client || getOpenAIClient();

    const batchRules = [
        getBIMManagerPrompt(),
        '',
        'BATCH OUTPUT RULES (STRICT):',
        `- Generate up to ${count} distinct, non-overlapping scenario questions from the numbered passages below.`,
        '- Skip passages that contain no testable standards rules. Do not invent facts.',
        '- Return a single JSON object with exact shape: { "questions": [ { "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correctAnswer": "A", "explanation": "..." } ] }.',
        '- Keep explanations concise (under 80 words each) to stay crisp and readable.'
    ].join('\n');

    const numberedPassages = chunks
        .map((chunk, idx) => `--- PASSAGE ${idx + 1} ---\n${chunk}`)
        .join('\n\n');

    // Compact exclusion stems keep Pass 2 deduplication cheap in tokens
    const avoidBlock = avoidQuestions.length > 0
        ? `\n\nDO NOT REPEAT OR PARAPHRASE THESE EXISTING QUESTIONS:\n${avoidQuestions.map((q, i) => `${i + 1}. ${q.slice(0, 90)}`).join('\n')}`
        : '';

    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: batchRules },
                { role: 'user', content: `${numberedPassages}${avoidBlock}` }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: Math.min(2400, Math.max(500, count * 360))
        });

        const rawContent = response.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(rawContent);

        let list = [];
        if (Array.isArray(parsed.questions)) {
            list = parsed.questions;
        } else if (isValidQuestionItem(parsed)) {
            list = [parsed];
        }

        const validQuestions = list.filter(isValidQuestionItem).slice(0, count);

        if (response.usage) {
            console.log(
                `[Token Telemetry] Model: ${model} | Prompt: ${response.usage.prompt_tokens} | Completion: ${response.usage.completion_tokens} | Total: ${response.usage.total_tokens} | Valid Qs: ${validQuestions.length}/${count}`
            );
        }

        return {
            questions: validQuestions,
            usage: response.usage || null
        };
    } catch (error) {
        console.error('[Agent Service Batch Error]:', error.message);
        throw new Error('Failed to generate or parse question batch from AI agent.');
    }
}

// Preserved for single-chunk callers
async function generateQuestionFromChunk(chunk, options = {}) {
    const { questions } = await generateQuestionsBatch([chunk], 1, options);
    if (questions.length === 0) {
        return { status: 'NO_FACTS' };
    }
    return questions[0];
}

module.exports = {
    generateQuestionsBatch,
    generateQuestionFromChunk,
    isValidQuestionItem
};