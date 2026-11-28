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

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MAX_AUDIT_ROWS = 60;

function parseMortaResourceUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new Error('Please provide a valid Morta Table or Document URL.');
    }

    const trimmed = rawUrl.trim();
    const tableMatch = trimmed.match(new RegExp(`tables?/(${UUID_PATTERN})`, 'i'));
    if (tableMatch) {
        return { type: 'table', id: tableMatch[1] };
    }

    const docMatch = trimmed.match(new RegExp(`documents?/(${UUID_PATTERN})`, 'i'));
    if (docMatch) {
        return { type: 'document', id: docMatch[1] };
    }

    throw new Error('Could not find a Morta Table (/table/...) or Document (/document/...) ID in that URL.');
}

async function mortaFetchJson(url, options = {}) {
    const { apiKey = null, fetchImpl = fetch } = options;
    const token = apiKey || process.env.MORTA_API_KEY || null;

    const buildHeaders = (useToken) => {
        const headers = { Accept: 'application/json' };
        if (useToken && token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    };

    let res = await fetchImpl(url, { headers: buildHeaders(true) });

    // If default server key gets 403 on another user's public hub, retry unauthenticated once
    if (res.status === 403 && !apiKey && token) {
        const publicRes = await fetchImpl(url, { headers: buildHeaders(false) });
        if (publicRes.ok) {
            res = publicRes;
        }
    }

    if (res.status === 401 || res.status === 403) {
        throw new Error('Access denied (403). Make sure the resource is in our shared Sandbox Hub, set to Public, or provide a temporary Morta API key.');
    }

    if (!res.ok) {
        throw new Error(`Morta API returned HTTP ${res.status} while loading deliverable.`);
    }

    return res.json();
}

function formatCellValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(formatCellValue).filter(Boolean).join(', ');
    if (typeof value === 'object') return String(value.name || value.label || value.title || JSON.stringify(value));
    return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim();
}

async function fetchTableAsText(tableId, options = {}) {
    const [metaPayload, rowsPayload] = await Promise.all([
        mortaFetchJson(`https://api.morta.io/v1/table/${tableId}`, options),
        mortaFetchJson(`https://api.morta.io/v1/table/${tableId}/row`, options)
    ]);

    const meta = metaPayload.data || metaPayload;
    const rawRows = Array.isArray(rowsPayload.data)
        ? rowsPayload.data
        : (Array.isArray(rowsPayload) ? rowsPayload : []);

    const sortedRows = [...rawRows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const totalRows = sortedRows.length;
    const limitedRows = sortedRows.slice(0, MAX_AUDIT_ROWS);

    let columns = Array.isArray(meta.columns)
        ? meta.columns.map(c => c.name).filter(Boolean)
        : [];

    if (columns.length === 0 && limitedRows.length > 0) {
        columns = Object.keys(limitedRows[0].rowData || {});
    }

    const header = `| # | ${columns.join(' | ')} |`;
    const divider = `| --- | ${columns.map(() => '---').join(' | ')} |`;
    const body = limitedRows.map((row, idx) => {
        const data = row.rowData || {};
        const cells = columns.map(col => formatCellValue(data[col]));
        return `| ${idx + 1} | ${cells.join(' | ')} |`;
    });

    const truncationNote = totalRows > MAX_AUDIT_ROWS
        ? `\n\n[Note: Showing first ${MAX_AUDIT_ROWS} of ${totalRows} rows to conserve tokens.]`
        : '';

    const content = [
        `Table Name: ${cleanText(meta.name || 'Untitled Table')}`,
        `Columns (${columns.length}): ${columns.join(', ')}`,
        `Total Rows: ${totalRows}`,
        '',
        header,
        divider,
        ...(body.length > 0 ? body : [`| (empty) | ${columns.map(() => '').join(' | ')} |`])
    ].join('\n') + truncationNote;

    return {
        type: 'table',
        id: tableId,
        name: cleanText(meta.name || 'Untitled Table'),
        rowCount: totalRows,
        columns,
        content
    };
}

async function fetchDeliverableFromUrl(rawUrl, options = {}) {
    const parsed = parseMortaResourceUrl(rawUrl);

    if (parsed.type === 'table') {
        return fetchTableAsText(parsed.id, options);
    }

    const docPayload = await mortaFetchJson(`https://api.morta.io/v1/document/${parsed.id}`, options);
    const doc = docPayload.data || docPayload;
    const chunks = flattenDocumentSections(doc.children || doc.sections || []);

    if (chunks.length === 0) {
        throw new Error('No extractable text sections found in this Morta document.');
    }

    return {
        type: 'document',
        id: parsed.id,
        name: cleanText(doc.name || 'Untitled Document'),
        rowCount: null,
        columns: null,
        content: chunks.join('\n\n')
    };
}

module.exports = {
    cleanText,
    extractDraftJsChunks,
    flattenDocumentSections,
    listHubDocuments,
    fetchDocumentText,
    clearHubCache,
    parseMortaResourceUrl,
    fetchTableAsText,
    fetchDeliverableFromUrl
};