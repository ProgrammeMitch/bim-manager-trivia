const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mortaService = require('../services/mortaService');
const { sampleChunks } = require('../utils/mathSampler');

describe('mortaService (zero-token unit tests)', () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.MORTA_API_KEY;

    beforeEach(() => {
        process.env.MORTA_API_KEY = 'test-fake-key';
        mortaService.clearHubCache();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env.MORTA_API_KEY = originalApiKey;
        mortaService.clearHubCache();
    });

    it('strips invisible zero-width spaces from Morta document titles', () => {
        const dirty = '\u200BGuidance 0: The case for information management\uFEFF ';
        assert.equal(mortaService.cleanText(dirty), 'Guidance 0: The case for information management');
    });

    it('filters deleted sections, skips short stubs, and outputs mathSampler-compatible chunks', async () => {
        const mockDocumentPayload = {
            data: {
                name: '\u200BGuidance 0: Test Doc',
                projectName: 'IMI Framework',
                children: [
                    {
                        publicId: 'sec-2',
                        name: '2.0 Delivery Rules',
                        position: 2,
                        isDeleted: false,
                        description: {
                            content: {
                                blocks: [
                                    {
                                        text: 'Every information container uploaded to the Common Data Environment must include a valid suitability code and revision number according to ISO 19650-2.'
                                    }
                                ]
                            }
                        },
                        children: []
                    },
                    {
                        publicId: 'sec-1',
                        name: '1.0 Stub Section',
                        position: 1,
                        isDeleted: false,
                        description: {
                            content: {
                                blocks: [{ text: 'Too short.' }]
                            }
                        },
                        children: []
                    },
                    {
                        publicId: 'sec-deleted',
                        name: 'Deleted Section',
                        position: 0,
                        isDeleted: true,
                        description: {
                            content: {
                                blocks: [
                                    {
                                        text: 'This deleted section has plenty of characters and should still never appear in extracted text.'
                                    }
                                ]
                            }
                        },
                        children: []
                    }
                ]
            }
        };

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => mockDocumentPayload
        });

        const result = await mortaService.fetchDocumentText('doc-123');
        assert.equal(result.documentName, 'Guidance 0: Test Doc');
        assert.equal(result.sectionChunkCount, 1);
        assert.ok(result.rawText.includes('[Section: 2.0 Delivery Rules]'));
        assert.ok(!result.rawText.includes('Deleted Section'));
        assert.ok(!result.rawText.includes('Too short.'));

        // Verify mathSampler.js parses the output without throwing or dropping chunks
        const sampled = sampleChunks(result.rawText, 5);
        assert.equal(sampled.length, 1);
        assert.ok(sampled[0].startsWith('[Section: 2.0 Delivery Rules]'));
    });

    it('caches hub document list and filters out deleted documents', async () => {
        let fetchCount = 0;

        global.fetch = async () => {
            fetchCount++;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: [
                        { publicId: 'b', name: '\u200BGuidance 2: Delivery', isDeleted: false },
                        { publicId: 'a', name: '\u200BGuidance 0: Intro', isDeleted: false },
                        { publicId: 'c', name: 'Old Deleted Doc', isDeleted: true }
                    ]
                })
            };
        };

        const first = await mortaService.listHubDocuments('hub-test');
        const second = await mortaService.listHubDocuments('hub-test');

        assert.equal(fetchCount, 1, 'Expected second call to serve from memory cache');
        assert.equal(first.length, 2);
        assert.equal(first[0].name, 'Guidance 0: Intro');
        assert.equal(second[1].name, 'Guidance 2: Delivery');
    });

    it('throws a clean error on non-200 Morta API responses', async () => {
        global.fetch = async () => ({ ok: false, status: 403 });
        await assert.rejects(
            () => mortaService.fetchDocumentText('doc-403'),
            /Morta Document API error \(403\)/
        );
    });
});