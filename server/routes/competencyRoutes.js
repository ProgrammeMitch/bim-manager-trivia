const express = require('express');
const fs = require('fs');
const path = require('path');

const { fetchDocumentText, fetchDeliverableFromUrl } = require('../services/mortaService');
const { getCompetencyCatalog, getChallengeById } = require('../competencies');
const { auditDeliverableAgainstChallenge } = require('../services/competencyAuditService');

const router = express.Router();

function getAllowlistPath() {
    if (process.env.ALLOWLIST_PATH) return process.env.ALLOWLIST_PATH;
    return process.env.RENDER
        ? '/etc/secrets/allowlist.json'
        : path.join(__dirname, '../utils/allowlist.json');
}

function verifyBetaAccess(req, res, next) {
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) {
        return res.status(403).json({ error: 'Access denied: No beta email provided.' });
    }

    try {
        const rawData = fs.readFileSync(getAllowlistPath(), 'utf8');
        const allowedEmails = JSON.parse(rawData);

        if (allowedEmails.includes(userEmail.toLowerCase().trim())) {
            return next();
        }
        return res.status(403).json({ error: 'Access denied: Email not on the active beta list or has expired.' });
    } catch (error) {
        console.error('[Competency Allowlist Error]:', error.message);
        return res.status(500).json({ error: 'Server error verifying access.' });
    }
}

// 1. Lightweight catalog metadata (0 AI tokens, matches /api/morta/documents access)
router.get('/api/competencies', (req, res) => {
    try {
        return res.json(getCompetencyCatalog());
    } catch (error) {
        console.error('[Competency Catalog Error]:', error.message);
        return res.status(500).json({ error: 'Unable to load competency catalog.' });
    }
});

// 2. Fetch live Morta Table/Document URL and run 1-call gpt-4o-mini audit
router.post('/api/competency/assess', verifyBetaAccess, async (req, res) => {
    try {
        const { mortaUrl, guidanceKey, challengeId, documentId, userMortaApiKey } = req.body || {};

        if (!mortaUrl) {
            return res.status(400).json({ error: 'Please paste a Morta Table or Document URL.' });
        }
        if (!guidanceKey || !challengeId) {
            return res.status(400).json({ error: 'Missing guidance or challenge identifier.' });
        }

        const challenge = getChallengeById(guidanceKey, challengeId);
        if (!challenge) {
            return res.status(404).json({ error: 'Competency challenge not found.' });
        }

        const deliverable = await fetchDeliverableFromUrl(mortaUrl, {
            apiKey: userMortaApiKey ? String(userMortaApiKey).trim() : null
        });

        let guidanceExcerpt = '';
        if (documentId) {
            try {
                const standard = await fetchDocumentText(documentId);
                guidanceExcerpt = standard.rawText || '';
            } catch (err) {
                console.warn('[Competency Audit] Skipping guidance excerpt:', err.message);
            }
        }

        const assessment = await auditDeliverableAgainstChallenge({
            challenge,
            deliverable,
            guidanceExcerpt
        });

        return res.json({
            deliverableMeta: {
                type: deliverable.type,
                id: deliverable.id,
                name: deliverable.name,
                rowCount: deliverable.rowCount
            },
            assessment
        });
    } catch (error) {
        console.error('[Competency Assess Error]:', error.message);
        const status = error.message.includes('403') ? 403 : 400;
        return res.status(status).json({ error: error.message || 'Failed to assess Morta deliverable.' });
    }
});

module.exports = router;