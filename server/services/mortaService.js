const DEFAULT_HUB_ID = 'a690e3a3-aa56-4a14-bb59-887f9c743b31';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_SECTION_CHARS = 80;

let hubDocsCache = {
    hubId: null,
    fetchedAt: 0,
    data: null
};

function cleanText(str = '') {
    return str.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function getAuthHeaders() {
    const apiKey = process.env.MORTA_API_KEY;
    if (!apiKey) {
        throw new Error('Missing MORTA_API_KEY in server environment variables.');
    }
    return {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
    };
}

// Extracts Draft.js blocks and groups short bullets so mathSampler keeps full rules intact
function extractDraftJsChunks(description, heading) {
    const blocks = description?.content?.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return [];

    const rawLines = blocks
        .map(block => cleanText(block.text || ''))
        .filter(Boolean);

    const totalRawChars = rawLines.reduce((sum, line) => sum + line.length, 0);
    if (totalRawChars < MIN_SECTION_CHARS) return [];

    const groupedParagraphs = [];
    let currentBuffer = '';

    for (const line of rawLines) {
        if (!currentBuffer) {
            currentBuffer = line;
        } else if (currentBuffer.length < 180 || line.length < 90) {
            currentBuffer += `\n${line}`;
        } else {
            groupedParagraphs.push(currentBuffer);
            currentBuffer = line;
        }
    }

    if (currentBuffer) {
        groupedParagraphs.push(currentBuffer);
    }

    // Single newline keeps the section heading attached to each chunk when mathSampler splits on \n\n
    return groupedParagraphs.map(para => `[Section: ${heading}]\n${para}`);
}

// Recursively traverses nested document sections in reading order
function flattenDocumentSections(sections = [], parentPath = '', chunks = []) {
    const sorted = [...sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    for (const section of sorted) {
        if (section.isDeleted) continue;

        const sectionName = cleanText(section.name || 'Untitled Section');
        const heading = parentPath ? `${parentPath} > ${sectionName}` : sectionName;

        const sectionChunks = extractDraftJsChunks(section.description, heading);
        chunks.push(...sectionChunks);

        if (Array.isArray(section.children) && section.children.length > 0) {
            flattenDocumentSections(section.children, heading, chunks);
        }
    }

    return chunks;
}

// Lists active documents in the IMI Framework hub (cached for 15 mins)
async function listHubDocuments(hubId = process.env.MORTA_HUB_ID || DEFAULT_HUB_ID, forceRefresh = false) {
    const now = Date.now();
    if (
        !forceRefresh &&
        hubDocsCache.data &&
        hubDocsCache.hubId === hubId &&
        (now - hubDocsCache.fetchedAt) < CACHE_TTL_MS
    ) {
        return hubDocsCache.data;
    }

    const response = await fetch(`https://api.morta.io/v1/hub/${hubId}/documents`, {
        method: 'GET',
        headers: getAuthHeaders()
    });

    if (!response.ok) {
        throw new Error(`Morta Hub API error (${response.status})`);
    }

    const payload = await response.json();
    const documents = (payload.data || [])
        .filter(doc => !doc.isDeleted)
        .map(doc => ({
            publicId: doc.publicId,
            name: cleanText(doc.name),
            updatedAt: doc.updatedAt || null
        }))
        .filter(doc => /^guidance\b/i.test(doc.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    hubDocsCache = {
        hubId,
        fetchedAt: now,
        data: documents
    };

    return documents;
}

// Fetches a single Morta document and returns formatted text ready for mathSampler.js
async function fetchDocumentText(documentId) {
    if (!documentId || typeof documentId !== 'string') {
        throw new Error('A valid Morta document ID is required.');
    }

    const response = await fetch(`https://api.morta.io/v1/document/${documentId}`, {
        method: 'GET',
        headers: getAuthHeaders()
    });

    if (!response.ok) {
        throw new Error(`Morta Document API error (${response.status})`);
    }

    const payload = await response.json();
    const doc = payload.data;

    if (!doc) {
        throw new Error('Morta API returned an empty document payload.');
    }

    const chunks = flattenDocumentSections(doc.children || []);
    if (chunks.length === 0) {
        throw new Error('No extractable text sections found in this Morta document.');
    }

    return {
        documentName: cleanText(doc.name || 'Morta Document'),
        hubName: cleanText(doc.projectName || 'Morta Hub'),
        sectionChunkCount: chunks.length,
        rawText: chunks.join('\n\n')
    };
}

function clearHubCache() {
    hubDocsCache = { hubId: null, fetchedAt: 0, data: null };
}

module.exports = {
    cleanText,
    extractDraftJsChunks,
    flattenDocumentSections,
    listHubDocuments,
    fetchDocumentText,
    clearHubCache
};