const { OpenAI } = require('openai');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let cachedClient = null;
function getOpenAIClient() {
    if (!cachedClient) {
        cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return cachedClient;
}

function finalizeScorecard(rawAudit, rubric = []) {
    const incoming = Array.isArray(rawAudit.criterionResults) ? rawAudit.criterionResults : [];

    const criterionResults = rubric.map((ref, idx) => {
        const match = incoming.find(item => item.id === ref.id) || incoming[idx] || {};
        const maxScore = Number(ref.maxScore) || 25;
        const clampedScore = Math.max(0, Math.min(maxScore, Math.round(Number(match.score) || 0)));

        return {
            id: ref.id,
            name: ref.name,
            score: clampedScore,
            maxScore,
            status: clampedScore >= Math.ceil(maxScore * 0.75) ? 'Pass' : 'Needs Revision',
            feedback: String(match.feedback || 'No specific feedback returned.').trim()
        };
    });

    const totalPossible = criterionResults.reduce((sum, c) => sum + c.maxScore, 0) || 100;
    const rawTotal = criterionResults.reduce((sum, c) => sum + c.score, 0);
    const totalScore = Math.round((rawTotal / totalPossible) * 100);
    const passed = totalScore >= 75;

    return {
        totalScore,
        passed,
        badge: totalScore >= 85 ? 'Competent (High Standard)' : (passed ? 'Competent' : 'Needs Revision'),
        summary: String(rawAudit.summary || '').trim(),
        strengths: Array.isArray(rawAudit.strengths) ? rawAudit.strengths.slice(0, 4) : [],
        improvements: Array.isArray(rawAudit.improvements) ? rawAudit.improvements.slice(0, 4) : [],
        criterionResults
    };
}

function buildMockAudit(challenge, deliverable) {
    const criterionResults = challenge.rubric.map((c, idx) => ({
        id: c.id,
        score: idx === 0 ? 16 : 23,
        feedback: idx === 0
            ? `[MOCK] Reviewed "${deliverable.name}": check Row 2 container type code (M3 vs DR).`
            : `[MOCK] "${deliverable.name}" meets ${c.name} expectations.`
    }));

    return finalizeScorecard({
        summary: `[MOCK_AI] Audited ${deliverable.type} "${deliverable.name}" against "${challenge.title}" (0 LLM tokens used).`,
        strengths: ['Table columns align with required TIDP structure.', 'Revision and suitability fields follow ISO 19650 format.'],
        improvements: ['Verify container type codes match 2D drawings vs 3D models.', 'Ensure 5 complete rows are populated.'],
        criterionResults
    }, challenge.rubric);
}

async function auditDeliverableAgainstChallenge({ challenge, deliverable, guidanceExcerpt = '', client = null }) {
    if (process.env.MOCK_AI === 'true' && !client) {
        return buildMockAudit(challenge, deliverable);
    }

    const openai = client || getOpenAIClient();
    const deliverableSnippet = String(deliverable?.content || '').slice(0, 6000);
    const referenceSnippet = String(guidanceExcerpt || '').slice(0, 3000);

    const systemPrompt = [
        'You are a strict, fair UK BIM Information Management Auditor grading a live Morta deliverable against ISO 19650 and IMI Guidance.',
        'Evaluate ONLY what is present in the submitted Morta deliverable. Cite specific row numbers, container IDs, or section headings when flagging issues.',
        'Score each rubric criterion from 0 to its maxScore.',
        'Return STRICT JSON with exact shape:',
        '{',
        '  "summary": "2-sentence overall verdict",',
        '  "strengths": ["Concrete strength 1", "Concrete strength 2"],',
        '  "improvements": ["Actionable fix 1", "Actionable fix 2"],',
        '  "criterionResults": [',
        '    { "id": "c1", "score": 0-25, "feedback": "Evidence-backed comment" }',
        '  ]',
        '}'
    ].join('\n');

    const userPrompt = [
        `CHALLENGE: ${challenge.title}`,
        `SCENARIO: ${challenge.scenario}`,
        `EXPECTED TYPE: ${challenge.deliverableType}`,
        challenge.requiredColumns ? `REQUIRED COLUMNS: ${challenge.requiredColumns.join(', ')}` : '',
        challenge.auditFocus?.length ? `AUDIT CHECKS:\n- ${challenge.auditFocus.join('\n- ')}` : '',
        `RUBRIC:\n${JSON.stringify(challenge.rubric)}`,
        referenceSnippet ? `\nIMI GUIDANCE REFERENCE EXCERPT:\n${referenceSnippet}` : '',
        `\nSUBMITTED MORTA DELIVERABLE (${deliverable.type.toUpperCase()} - "${deliverable.name}"):\n${deliverableSnippet}`
    ].filter(Boolean).join('\n\n');

    const response = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1000
    });

    const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');

    if (response.usage) {
        console.log(`[Token Telemetry - Competency Audit] Model: ${DEFAULT_MODEL} | Challenge: ${challenge.id} | Total: ${response.usage.total_tokens}`);
    }

    return finalizeScorecard(parsed, challenge.rubric);
}

module.exports = { auditDeliverableAgainstChallenge, finalizeScorecard };