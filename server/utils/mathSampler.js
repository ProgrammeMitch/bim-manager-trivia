function sampleChunks(rawText, maxQuestions) {
    try {
        if (!rawText || typeof rawText !== 'string') {
            throw new Error("Invalid text input provided to sampler.");
        }

        // 1. Split text by double line breaks to isolate original paragraphs
        // Filter out headers, page numbers, or empty space under 50 characters
        const paragraphs = rawText.split(/\n\s*\n/).filter(p => p.trim().length > 50);

        // 2. Fisher-Yates Shuffle to completely randomize the paragraph pool
        for (let i = paragraphs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [paragraphs[i], paragraphs[j]] = [paragraphs[j], paragraphs[i]];
        }

        // 3. Pluck only the requested number of chunks from the randomized deck
        // If there are fewer paragraphs than requested, slice safely returns all of them
        return paragraphs.slice(0, maxQuestions);

    } catch (error) {
        console.error("[MathSampler Error]:", error.message);
        throw new Error("Failed to execute randomized chunking algorithm.");
    }
}

module.exports = { sampleChunks };