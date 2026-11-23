const MIN_CHUNK_CHARS = 150;
const FALLBACK_MIN_CHARS = 60;
const MAX_CHUNK_CHARS = 1600;

const HIGH_SIGNAL_REGEX = /\b(iso\s*19650|shall|must|cde|bep|eir|oir|air|midp|tidp|suitability|revision|appointing\s+party|appointed\s+party|information\s+container|federated|cobie|ifc|uniclass|mobilisation|approval|status\s+code|wip|shared|published)\b/i;

function fisherYatesShuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function capChunkLength(text, maxChars = MAX_CHUNK_CHARS) {
    const cleaned = text.trim();
    if (cleaned.length <= maxChars) return cleaned;

    // Trim cleanly at the last sentence or word boundary
    const sliced = cleaned.slice(0, maxChars);
    const lastPeriod = sliced.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.7) {
        return sliced.slice(0, lastPeriod + 1).trim();
    }
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim();
}

function buildShuffledDeck(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('Invalid text input provided to sampler.');
    }

    const rawParagraphs = rawText
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(Boolean);

    // Prefer substantive chunks (>= 150 chars); fall back to >= 60 chars for very short docs
    let eligible = rawParagraphs.filter(p => p.length >= MIN_CHUNK_CHARS);
    if (eligible.length < 3) {
        eligible = rawParagraphs.filter(p => p.length >= FALLBACK_MIN_CHARS);
    }

    const capped = eligible.map(p => capChunkLength(p));

    // Tier 1: rule-dense BIM/ISO chunks first; Tier 2: general narrative chunks
    const highSignal = fisherYatesShuffle(capped.filter(p => HIGH_SIGNAL_REGEX.test(p)));
    const standard = fisherYatesShuffle(capped.filter(p => !HIGH_SIGNAL_REGEX.test(p)));

    return [...highSignal, ...standard];
}

// Preserved for backward compatibility with existing callers
function sampleChunks(rawText, maxQuestions) {
    try {
        const deck = buildShuffledDeck(rawText);
        return deck.slice(0, maxQuestions);
    } catch (error) {
        console.error('[MathSampler Error]:', error.message);
        throw new Error('Failed to execute randomized chunking algorithm.');
    }
}

module.exports = { buildShuffledDeck, sampleChunks, capChunkLength };