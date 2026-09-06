const { sampleChunks } = require('../utils/mathSampler');

describe('Mathematical Text Sampler', () => {
    it('should extract exactly the requested number of chunks evenly spaced', () => {
        // Appending extra text ensures each paragraph exceeds the 50-character filter
        const dummyText = Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1} contains sufficient filler text to comfortably bypass the fifty character minimum length threshold set in the extraction algorithm.`).join('\n\n');
        const chunks = sampleChunks(dummyText, 20);
        
        expect(chunks.length).toBe(20);
        expect(chunks[0]).toContain('Paragraph 1 contains');
        // If step is 5 (100/20), the second chunk should be Paragraph 6
        expect(chunks[1]).toContain('Paragraph 6 contains'); 
    });

    it('should safely handle text smaller than the requested chunk count', () => {
        const smallText = 'Paragraph 1 contains enough text to comfortably exceed the fifty character minimum.\n\nParagraph 2 also contains sufficient string length to completely bypass the filter limit.';
        const chunks = sampleChunks(smallText, 20);
        expect(chunks.length).toBe(2);
    });
});