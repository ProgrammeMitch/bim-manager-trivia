const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('generateRoutes (zero-token integration tests)', () => {
    let server;
    let baseUrl;
    let tempAllowlistPath;
    let aiCallCount = 0;

    const agentPath = require.resolve('../services/agentService');
    const mortaPath = require.resolve('../services/mortaService');
    const routePath = require.resolve('../routes/generateRoutes');

    const originalAllowlistEnv = process.env.ALLOWLIST_PATH;
    const originalMockAiEnv = process.env.MOCK_AI;

    before(async () => {
        // 1. Create isolated temp allowlist so your real allowlist.json is never touched
        tempAllowlistPath = path.join(os.tmpdir(), `allowlist-test-${Date.now()}.json`);
        fs.writeFileSync(tempAllowlistPath, JSON.stringify(['tester@morta.io']));
        process.env.ALLOWLIST_PATH = tempAllowlistPath;
        process.env.MOCK_AI = 'false';

        // 2. Stub agentService BEFORE loading generateRoutes so zero real AI calls happen
        require.cache[agentPath] = {
            id: agentPath,
            filename: agentPath,
            loaded: true,
            exports: {
                generateQuestionFromChunk: async (chunk) => {
                    aiCallCount++;
                    return {
                        question: `Mock Q${aiCallCount} from chunk`,
                        options: { A: 'Opt A', B: 'Opt B', C: 'Opt C', D: 'Opt D' },
                        correctAnswer: 'A',
                        explanation: `Grounded in: ${chunk.slice(0, 40)}`
                    };
                }
            }
        };

        // 3. Stub mortaService so zero live Morta HTTP calls happen
        require.cache[mortaPath] = {
            id: mortaPath,
            filename: mortaPath,
            loaded: true,
            exports: {
                listHubDocuments: async () => [
                    { publicId: 'doc-1', name: 'Guidance 0: Intro' },
                    { publicId: 'doc-2', name: 'Guidance 2: Delivery phase' }
                ],
                fetchDocumentText: async (docId) => {
                    if (docId === 'missing-doc') {
                        throw new Error('Morta Document API error (404)');
                    }
                    return {
                        documentName: 'Guidance 0: Intro',
                        hubName: 'IMI Framework',
                        sectionChunkCount: 2,
                        rawText: [
                            '[Section: 1.0]\nInformation management requires proportionate security controls across the whole asset lifecycle.',
                            '[Section: 2.0]\nThe Lead Appointed Party coordinates task information delivery plans into a Master Information Delivery Plan.'
                        ].join('\n\n')
                    };
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
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        if (tempAllowlistPath && fs.existsSync(tempAllowlistPath)) {
            fs.unlinkSync(tempAllowlistPath);
        }
        delete require.cache[agentPath];
        delete require.cache[mortaPath];
        delete require.cache[routePath];

        if (originalAllowlistEnv === undefined) delete process.env.ALLOWLIST_PATH;
        else process.env.ALLOWLIST_PATH = originalAllowlistEnv;

        if (originalMockAiEnv === undefined) delete process.env.MOCK_AI;
        else process.env.MOCK_AI = originalMockAiEnv;
    });

    it('GET /api/morta/documents returns the guidance list', async () => {
        const res = await fetch(`${baseUrl}/api/morta/documents`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.documents.length, 2);
        assert.equal(body.documents[0].publicId, 'doc-1');
    });

    it('POST /generate-from-morta rejects unauthorized emails with 403', async () => {
        const res = await fetch(`${baseUrl}/generate-from-morta`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': 'intruder@example.com'
            },
            body: JSON.stringify({ documentId: 'doc-1', questionCount: 5 })
        });
        assert.equal(res.status, 403);
    });

    it('POST /generate-from-morta streams SSE progress and COMPLETE payload', async () => {
        aiCallCount = 0;

        const res = await fetch(`${baseUrl}/generate-from-morta`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': 'tester@morta.io'
            },
            body: JSON.stringify({ documentId: 'doc-1', questionCount: 5 })
        });

        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type').includes('text/event-stream'));

        const rawStream = await res.text();
        const events = rawStream
            .split('\n\n')
            .filter(line => line.startsWith('data: '))
            .map(line => JSON.parse(line.slice(6)));

        const finalEvent = events[events.length - 1];
        assert.equal(finalEvent.status, 'COMPLETE');
        assert.equal(finalEvent.progress, 100);
        assert.equal(finalEvent.data.length, 2);
        assert.equal(aiCallCount, 2);
    });

    it('POST /generate-from-morta emits SSE ERROR event when document fetch fails', async () => {
        const res = await fetch(`${baseUrl}/generate-from-morta`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': 'tester@morta.io'
            },
            body: JSON.stringify({ documentId: 'missing-doc', questionCount: 5 })
        });

        const rawStream = await res.text();
        const events = rawStream
            .split('\n\n')
            .filter(line => line.startsWith('data: '))
            .map(line => JSON.parse(line.slice(6)));

        const errorEvent = events.find(e => e.status === 'ERROR');
        assert.ok(errorEvent, 'Expected an ERROR SSE event');
        assert.match(errorEvent.data.message, /404/);
    });
});