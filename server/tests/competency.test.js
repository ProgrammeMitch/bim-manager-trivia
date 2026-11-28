const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseMortaResourceUrl, fetchTableAsText } = require('../services/mortaService');
const { getCompetencyCatalog, extractGuidanceKey } = require('../competencies');
const { finalizeScorecard } = require('../services/competencyAuditService');

describe('Morta URL parser & live table normalizer (zero-token)', () => {
    it('extracts table_id while ignoring hub_id and view_id', () => {
        const url = 'https://app.morta.io/hub/9ff25925-c9f1-4694-9656-a54d59e118d8/table/89351074-baf9-4828-b57f-a8a960fda77f/view/c5978c51-f4b7-4999-90ff-f9891d35a05f';
        assert.deepEqual(parseMortaResourceUrl(url), {
            type: 'table',
            id: '89351074-baf9-4828-b57f-a8a960fda77f'
        });
    });

    it('normalizes Morta /v1/table + /row payload into a sorted pipe table', async () => {
        const fakeFetch = async (url) => {
            if (url.endsWith('/row')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                sortOrder: 2,
                                rowData: {
                                    'Container ID': 'PRJ-ARC-ZZ-01-M3-A-0102',
                                    'Title': 'Ground Floor Plan',
                                    'Suitability Code': 'S3',
                                    'Revision': 'P02'
                                }
                            },
                            {
                                sortOrder: 1,
                                rowData: {
                                    'Container ID': 'PRJ-ARC-ZZ-01-M3-A-0001',
                                    'Title': 'Level 1 Architectural Model',
                                    'Suitability Code': 'S2',
                                    'Revision': 'P01'
                                }
                            }
                        ]
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        name: 'Test TIDP',
                        columns: [
                            { name: 'Container ID' },
                            { name: 'Title' },
                            { name: 'Suitability Code' },
                            { name: 'Revision' }
                        ]
                    }
                })
            };
        };

        const result = await fetchTableAsText('89351074-baf9-4828-b57f-a8a960fda77f', {
            apiKey: 'test-key',
            fetchImpl: fakeFetch
        });

        assert.equal(result.name, 'Test TIDP');
        assert.equal(result.rowCount, 2);
        assert.ok(result.content.includes('| 1 | PRJ-ARC-ZZ-01-M3-A-0001 | Level 1 Architectural Model | S2 | P01 |'));
        assert.ok(result.content.includes('| 2 | PRJ-ARC-ZZ-01-M3-A-0102 | Ground Floor Plan | S3 | P02 |'));
    });
});

describe('Competency catalog & deterministic scorecard (zero-token)', () => {
    it('exposes Guidance F pre-unlocked with 1 table challenge and normalizes guidance keys', () => {
        const catalog = getCompetencyCatalog();
        assert.equal(catalog.defaultUnlockScore, 2500);
        assert.equal(catalog.modules['guidance-f'].unlockedByDefault, true);
        assert.equal(catalog.modules['guidance-f'].challenges[0].id, 'guidance-f-tidp-v1');
        assert.equal(extractGuidanceKey('Guidance F - Information delivery planning'), 'guidance-f');
    });

    it('clamps out-of-range AI criterion scores and computes exact 0-100 rating', () => {
        const rubric = [
            { id: 'c1', name: 'Naming', maxScore: 25 },
            { id: 'c2', name: 'Suitability', maxScore: 25 },
            { id: 'c3', name: 'Revision', maxScore: 25 },
            { id: 'c4', name: 'Completeness', maxScore: 25 }
        ];

        const scorecard = finalizeScorecard({
            summary: 'Solid structure.',
            strengths: ['Valid codes'],
            improvements: ['Fix Row 2 type code'],
            criterionResults: [
                { id: 'c1', score: 18, feedback: 'Check M3 vs DR' },
                { id: 'c2', score: 99, feedback: 'Should clamp to 25' },
                { id: 'c3', score: 23, feedback: 'Good' },
                { id: 'c4', score: 10, feedback: 'Only 2 rows' }
            ]
        }, rubric);

        assert.equal(scorecard.totalScore, 76);
        assert.equal(scorecard.passed, true);
        assert.equal(scorecard.criterionResults[1].score, 25);
    });
});

describe('Competency Express routes integration (zero-token)', () => {
    let server;
    let baseUrl;
    let tempAllowlist;

    const mortaPath = require.resolve('../services/mortaService');
    const routePath = require.resolve('../routes/competencyRoutes');
    const origAllowlist = process.env.ALLOWLIST_PATH;
    const origMockAi = process.env.MOCK_AI;

    before(async () => {
        tempAllowlist = path.join(os.tmpdir(), `allowlist-comp-${Date.now()}.json`);
        fs.writeFileSync(tempAllowlist, JSON.stringify(['chinonso2.mbagha@live.uwe.ac.uk']));
        process.env.ALLOWLIST_PATH = tempAllowlist;
        process.env.MOCK_AI = 'true';

        require.cache[mortaPath] = {
            id: mortaPath,
            filename: mortaPath,
            loaded: true,
            exports: {
                fetchDocumentText: async () => ({ rawText: 'IMI Guidance F reference rules...' }),
                fetchDeliverableFromUrl: async () => ({
                    type: 'table',
                    id: '89351074-baf9-4828-b57f-a8a960fda77f',
                    name: 'Test TIDP',
                    rowCount: 2,
                    content: '| # | Container ID | Title |\n| --- | --- | --- |\n| 1 | PRJ-ARC-ZZ-01-M3-A-0001 | Level 1 Model |'
                })
            }
        };

        delete require.cache[routePath];
        const competencyRoutes = require(routePath);

        const app = express();
        app.use(express.json());
        app.use('/', competencyRoutes);

        await new Promise(resolve => {
            server = app.listen(0, '127.0.0.1', () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        if (tempAllowlist && fs.existsSync(tempAllowlist)) fs.unlinkSync(tempAllowlist);
        delete require.cache[mortaPath];
        delete require.cache[routePath];

        if (origAllowlist === undefined) delete process.env.ALLOWLIST_PATH;
        else process.env.ALLOWLIST_PATH = origAllowlist;

        if (origMockAi === undefined) delete process.env.MOCK_AI;
        else process.env.MOCK_AI = origMockAi;
    });

    it('returns catalog on GET /api/competencies and enforces beta allowlist on POST /api/competency/assess', async () => {
        const catRes = await fetch(`${baseUrl}/api/competencies`);
        assert.equal(catRes.status, 200);
        const catJson = await catRes.json();
        assert.ok(catJson.modules['guidance-f']);

        // Blocked without email
        const deniedRes = await fetch(`${baseUrl}/api/competency/assess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mortaUrl: 'https://app.morta.io/hub/9ff25925-c9f1-4694-9656-a54d59e118d8/table/89351074-baf9-4828-b57f-a8a960fda77f',
                guidanceKey: 'guidance-f',
                challengeId: 'guidance-f-tidp-v1'
            })
        });
        assert.equal(deniedRes.status, 403);

        // Allowed with allowlisted email (MOCK_AI=true -> 0 OpenAI tokens)
        const okRes = await fetch(`${baseUrl}/api/competency/assess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': 'chinonso2.mbagha@live.uwe.ac.uk'
            },
            body: JSON.stringify({
                mortaUrl: 'https://app.morta.io/hub/9ff25925-c9f1-4694-9656-a54d59e118d8/table/89351074-baf9-4828-b57f-a8a960fda77f',
                guidanceKey: 'guidance-f',
                challengeId: 'guidance-f-tidp-v1'
            })
        });
        assert.equal(okRes.status, 200);
        const okJson = await okRes.json();
        assert.equal(okJson.deliverableMeta.name, 'Test TIDP');
        assert.equal(typeof okJson.assessment.totalScore, 'number');
    });
});