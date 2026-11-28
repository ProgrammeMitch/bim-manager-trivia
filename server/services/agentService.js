const { OpenAI } = require('openai');
const { getBIMManagerPrompt } = require('../utils/prompts');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

let cachedClient = null;
function getOpenAIClient() {
    if (!cachedClient) {
        cachedClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return cachedClient;
}

function normalizeAnswerLetter(rawAnswer) {
    const match = String(rawAnswer || '').trim().toUpperCase().match(/\b([A-D])\b/);
    return match ? match[1] : null;
}

function fisherYatesShuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function isValidQuestionItem(item) {
    const normalizedKey = normalizeAnswerLetter(item?.correctAnswer);
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
        normalizedKey &&
        item.options[normalizedKey] &&
        typeof item.explanation === 'string'
    );
}

/**
 * Shuffles a single question's A-D options and updates correctAnswer.
 * If targetLetter is provided, places the correct answer in that exact slot.
 */
function shuffleQuestionOptions(item, targetLetter = null) {
    const oldCorrectKey = normalizeAnswerLetter(item.correctAnswer);
    if (!oldCorrectKey || !item.options || !item.options[oldCorrectKey]) {
        return item;
    }

    const chosenLetter = OPTION_LETTERS.includes(targetLetter)
        ? targetLetter
        : OPTION_LETTERS[Math.floor(Math.random() * OPTION_LETTERS.length)];

    const distractors = fisherYatesShuffle(
        OPTION_LETTERS
            .filter(letter => letter !== oldCorrectKey)
            .map(letter => ({ oldKey: letter, text: item.options[letter] }))
    );

    const newOptions = {};
    const oldToNewMap = {};
    let distractorIndex = 0;

    for (const newKey of OPTION_LETTERS) {
        if (newKey === chosenLetter) {
            newOptions[newKey] = item.options[oldCorrectKey];
            oldToNewMap[oldCorrectKey] = newKey;
        } else {
            const entry = distractors[distractorIndex++];
            newOptions[newKey] = entry.text;
            oldToNewMap[entry.oldKey] = newKey;
        }
    }

    // Defensive single-pass remap only if the model accidentally wrote "Option B" or "Choice A"
    const updatedExplanation = typeof item.explanation === 'string'
        ? item.explanation.replace(/\b(Option|Choice)\s+([A-D])\b/gi, (_, prefix, letter) => {
            const mapped = oldToNewMap[letter.toUpperCase()] || letter;
            return `${prefix} ${mapped}`;
        })
        : item.explanation;

    return {
        ...item,
        options: newOptions,
        correctAnswer: chosenLetter,
        explanation: updatedExplanation
    };
}

/**
 * Builds a balanced, randomized sequence of A-D answer slots across an entire quiz
 * (for 10 questions: every letter appears 2 or 3 times, avoiding 3+ identical answers in a row).
 */
function balanceQuestionAnswers(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return [];

    const slotPool = [];
    while (slotPool.length < questions.length) {
        slotPool.push(...fisherYatesShuffle(OPTION_LETTERS));
    }

    const targetSlots = fisherYatesShuffle(slotPool.slice(0, questions.length));

    // Break up any accidental runs of 3 identical letters in a row
    for (let i = 2; i < targetSlots.length; i++) {
        if (targetSlots[i] === targetSlots[i - 1] && targetSlots[i] === targetSlots[i - 2]) {
            const swapIdx = targetSlots.findIndex((letter, idx) =>
                idx > i && letter !== targetSlots[i]
            );
            if (swapIdx !== -1) {
                [targetSlots[i], targetSlots[swapIdx]] = [targetSlots[swapIdx], targetSlots[i]];
            }
        }
    }

    return questions.map((q, idx) => shuffleQuestionOptions(q, targetSlots[idx]));
}

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
        '- In explanations, refer to choices by their wording or concept, NEVER by option letters (A, B, C, or D), because answer order is shuffled programmatically.',
        '- Keep explanations concise (under 80 words each) to stay crisp and readable.'
    ].join('\n');

    const numberedPassages = chunks
        .map((chunk, idx) => `--- PASSAGE ${idx + 1} ---\n${chunk}`)
        .join('\n\n');

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

        const validQuestions = balanceQuestionAnswers(
            list.filter(isValidQuestionItem).slice(0, count)
        );

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
    isValidQuestionItem,
    shuffleQuestionOptions,
    balanceQuestionAnswers
};