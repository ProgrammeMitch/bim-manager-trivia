const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildShuffledDeck, capChunkLength } = require('../utils/mathSampler');
const { generateQuestionsBatch } = require('../services/agentService');

describe('mathSampler token-saving rules', () => {
    it('drops short stubs, caps oversized chunks, and prioritizes BIM/ISO rule chunks', () => {
        const genericLong = 'This narrative paragraph discusses general team communication practices across multiple regional offices and encourages collaborative workshops throughout the calendar year without referencing specific compliance clauses.';
        const isoRuleLong = 'According to ISO 19650-2, every information container uploaded to the CDE must carry an approved suitability code and revision identifier before transitioning from WIP to Shared status.';
        const hugeParagraph = `${isoRuleLong} `.repeat(25);

        const rawText = [
            'Short stub header.',
            genericLong,
            isoRuleLong,
            hugeParagraph
        ].join('\n\n');

        const deck = buildShuffledDeck(rawText);

        assert.equal(deck.length, 3, 'Short stub under 150 chars should be dropped');
        assert.ok(deck[0].includes('ISO 19650') || deck[0].includes('CDE'), 'High-signal rule chunks must come before generic filler');
        assert.ok(deck.every(c => c.length <= 1600), 'All chunks must be capped at 1600 chars');
        assert.ok(capChunkLength(hugeParagraph, 500).length <= 500);
    });
});

describe('agentService batching (zero-token unit tests)', () => {
    it('batches multiple chunks into one call, uses gpt-4o-mini by default, and filters invalid items', async () => {
        let capturedRequest = null;

        const fakeOpenAI = {
            chat: {
                completions: {
                    create: async (params) => {
                        capturedRequest = params;
                        return {
                            choices: [{
                                message: {
                                    content: JSON.stringify({
                                        questions: [
                                            {
                                                question: 'What must accompany every CDE container?',
                                                options: { A: 'Suitability code', B: 'Color tag', C: 'Zip file', D: 'Email' },
                                                correctAnswer: 'A',
                                                explanation: 'ISO 19650 requires suitability codes.'
                                            },
                                            { status: 'NO_FACTS' }
                                        ]
                                    })
                                }
                            }],
                            usage: { prompt_tokens: 400, completion_tokens: 120, total_tokens: 520 }
                        };
                    }
                }
            }
        };

        const result = await generateQuestionsBatch(
            ['Passage 1 about ISO 19650.', 'Passage 2 about BEPs.'],
            3,
            { avoidQuestions: ['Old question stem'], client: fakeOpenAI }
        );

        assert.equal(capturedRequest.model, 'gpt-4o-mini');
        assert.equal(capturedRequest.response_format.type, 'json_object');
        assert.ok(capturedRequest.messages[1].content.includes('Old question stem'));
        assert.equal(result.questions.length, 1);
    });
});

describe('Target-Driven Queue in generateRoutes (zero-token integration tests)', () => {
    let server;
    let baseUrl;
    let tempAllowlistPath;
    let mockScenario = 'refill';
    let batchCalls = 0;

    const agentPath = require.resolve('../services/agentService');
    const mortaPath = require.resolve('../services/mortaService');
    const routePath = require.resolve('../routes/generateRoutes');

    const originalAllowlistEnv = process.env.ALLOWLIST_PATH;
    const originalMockAiEnv = process.env.MOCK_AI;

    function makeMockQuestion(idx) {
        return {
            question: `Unique compliance scenario question #${idx}?`,
            options: { A: 'Ans A', B: 'Ans B', C: 'Ans C', D: 'Ans D' },
            correctAnswer: 'A',
            explanation: `Explanation for #${idx}`
        };
    }

    before(async () => {
        tempAllowlistPath = path.join(os.tmpdir(), `allowlist-queue-${Date.now()}.json`);
        fs.writeFileSync(tempAllowlistPath, JSON.stringify(['tester@morta.io']));
        process.env.ALLOWLIST_PATH = tempAllowlistPath;
        process.env.MOCK_AI = 'false';

        require.cache[agentPath] = {
            id: agentPath,
            filename: agentPath,
            loaded: true,
            exports: {
                generateQuestionsBatch: async (chunks, count, { avoidQuestions = [] } = {}) => {
                    batchCalls++;

                    if (mockScenario === 'empty-circuit-breaker') {
                        return { questions: [], usage: null };
                    }

                    if (mockScenario === 'refill') {
                        // Batch 1 only returns 4 valid questions; subsequent batches return up to count
                        const produce = batchCalls === 1 ? 4 : count;
                        const start = avoidQuestions.length + 1;
                        return {
                            questions: Array.from({ length: produce }, (_, i) => makeMockQuestion(start + i)),
                            usage: null
                        };
                    }

                    if (mockScenario === 'short-doc-pass2') {
                        const start = avoidQuestions.length + 1;
                        return {
                            questions: Array.from({ length: count }, (_, i) => makeMockQuestion(start + i)),
                            usage: null
                        };
                    }

                    return { questions: [], usage: null };
                }
            }
        };

        require.cache[mortaPath] = {
            id: mortaPath,
            filename: mortaPath,
            loaded: true,
            exports: {
                listHubDocuments: async () => [],
                fetchDocumentText: async (docId) => {
                    if (docId === 'short-doc') {
                        // Only 2 long paragraphs, forcing Pass 2 recycling to reach 10 questions
                        const longA = 'ISO 19650-2 mandates that the Appointing Party defines Exchange Information Requirements and acceptance criteria before inviting tenders from prospective Lead Appointed Parties across all delivery stages.'.repeat(2);
                        const longB = 'The Lead Appointed Party consolidates Task Information Delivery Plans into the Master Information Delivery Plan and verifies CDE suitability codes prior to publishing deliverables.'.repeat(2);
                        return { documentName: 'Short Guidance', hubName: 'IMI', rawText: `${longA}\n\n${longB}` };
                    }

                    // Standard 15-section document
                    const sections = Array.from({ length: 15 }, (_, i) =>
                        `[Section ${i + 1}] Under ISO 19650 governance rule ${i + 1}, every task team must verify CDE metadata, revision status, and container naming compliance before submitting models to the Shared area.`
                    );
                    return { documentName: 'Standard Guidance', hubName: 'IMI', rawText: sections.join('\n\n') };
                }
            }
        };

        delete require.cache[routePath];
        const generateRoutes = require(routePath);

        const app = express();
        app.use('/', generateRoutes);

        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const { port } = server.address();
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (tempAllowlistPath && fs.existsSync(tempAllowlistPath)) fs.unlinkSync(tempAllowlistPath);
        delete require.cache[agentPath];
        delete require.cache[mortaPath];
        delete require.cache[routePath];

        if (originalAllowlistEnv === undefined) delete process.env.ALLOWLIST_PATH;
        else process.env.ALLOWLIST_PATH = originalAllowlistEnv;

        if (originalMockAiEnv === undefined) delete process.env.MOCK_AI;
        else process.env.MOCK_AI = originalMockAiEnv;
    });

    async function callMortaGenerate(documentId, questionCount = 10) {
        const res = await fetch(`${baseUrl}/generate-from-morta`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': 'tester@morta.io'
            },
            body: JSON.stringify({ documentId, questionCount })
        });
        const raw = await res.text();
        return raw
            .split('\n\n')
            .filter(line => line.startsWith('data: '))
            .map(line => JSON.parse(line.slice(6)));
    }

    it('auto-refills silently until 10 questions are met even when user requests fewer', async () => {
        mockScenario = 'refill';
        batchCalls = 0;

        const events = await callMortaGenerate('standard-doc', 5);
        const finalEvent = events[events.length - 1];

        assert.equal(finalEvent.status, 'COMPLETE');
        assert.equal(finalEvent.data.length, 10, 'Minimum 10 questions must be enforced');
        assert.equal(batchCalls, 3, 'Batch 1 (4 Qs) + Batch 2 (5 Qs) + Batch 3 (1 Q) = 3 total API calls');
    });

    it('triggers Pass 2 recycling to hit 10 questions on a short 2-section document', async () => {
        mockScenario = 'short-doc-pass2';
        batchCalls = 0;

        const events = await callMortaGenerate('short-doc', 10);
        const finalEvent = events[events.length - 1];

        assert.equal(finalEvent.status, 'COMPLETE');
        assert.equal(finalEvent.data.length, 10);
        assert.equal(batchCalls, 2, 'Should reach 10 questions in just 2 batched calls');
    });

    it('trips the circuit breaker after 3 empty batches instead of burning tokens', async () => {
        mockScenario = 'empty-circuit-breaker';
        batchCalls = 0;

        const events = await callMortaGenerate('standard-doc', 10);
        const errorEvent = events.find(e => e.status === 'ERROR');

        assert.ok(errorEvent, 'Expected ERROR event when no questions can be extracted');
        assert.equal(batchCalls, 3, 'Circuit breaker must halt after 3 consecutive empty batches');
    });

    it('clamps requests above 15 down to 15 questions to protect tokens', async () => {
        mockScenario = 'short-doc-pass2';
        batchCalls = 0;

        const events = await callMortaGenerate('standard-doc', 25);
        const finalEvent = events[events.length - 1];

        assert.equal(finalEvent.status, 'COMPLETE');
        assert.equal(finalEvent.data.length, 15, 'Maximum 15 questions must be enforced');
        assert.equal(batchCalls, 3, 'Should finish 15 questions in 3 batched calls');
    });
});