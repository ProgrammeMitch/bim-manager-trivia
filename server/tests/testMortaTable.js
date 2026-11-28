const fs = require('fs');
const path = require('path');

// Load server/.env without requiring extra dependencies
const envPath = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env')
].find(p => fs.existsSync(p));
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    }
}

const input = process.argv[2] || 'https://app.morta.io/hub/9ff25925-c9f1-4694-9656-a54d59e118d8/table/89351074-baf9-4828-b57f-a8a960fda77f/view/c5978c51-f4b7-4999-90ff-f9891d35a05f';
if (!input) {
    console.error('Usage: node server/testMortaTable.js "<MORTA_TABLE_URL_OR_UUID>"');
    process.exit(1);
}

const apiKey = process.env.MORTA_API_KEY;
if (!apiKey) {
    console.error('Missing MORTA_API_KEY in server/.env');
    process.exit(1);
}

function extractTableId(raw) {
    // Prefer explicit /table/<uuid> or /tables/<uuid> so view/hub UUIDs are ignored
    const explicitMatch = raw.match(/tables?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (explicitMatch) return explicitMatch[1];

    // Fallback to the last UUID found in the input
    const allUuids = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    return allUuids ? allUuids[allUuids.length - 1] : raw.trim();
}

async function inspectTable() {
    const tableId = extractTableId(input);
    console.log('Input URL/ID:', input);
    console.log('Extracted Table ID:', tableId);

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
    };

    // 1. Inspect table metadata, columns, and any inline rows
    const tableRes = await fetch(`https://api.morta.io/v1/table/${tableId}`, { headers });
    console.log(`\nGET /v1/table/${tableId} -> HTTP ${tableRes.status}`);

    const tableJson = await tableRes.json();
    if (!tableRes.ok) {
        console.error('Error payload:', JSON.stringify(tableJson, null, 2));
        process.exit(1);
    }

    const data = tableJson.data || tableJson;
    console.log('Top-level keys in data:', Object.keys(data));

    if (Array.isArray(data.columns)) {
        console.log(`\nColumns (${data.columns.length} total, showing first 6):`);
        console.log(JSON.stringify(data.columns.slice(0, 6), null, 2));
    }

    if (Array.isArray(data.rows)) {
        console.log(`\nInline rows found (${data.rows.length} total, showing first 2):`);
        console.log(JSON.stringify(data.rows.slice(0, 2), null, 2));
        return;
    }

    if (!Array.isArray(data.columns)) {
        console.log('\nUnexpected schema preview:');
        console.log(JSON.stringify(data, null, 2).slice(0, 2500));
    }

    // 2. If rows are not inline, check /v1/table/{id}/row
    console.log('\nNo inline `rows` array found. Checking GET /v1/table/{id}/row ...');
    const rowsRes = await fetch(`https://api.morta.io/v1/table/${tableId}/row`, { headers });
    console.log(`GET /v1/table/${tableId}/row -> HTTP ${rowsRes.status}`);

    const rowsText = await rowsRes.text();
    try {
        const rowsJson = JSON.parse(rowsText);
        const list = Array.isArray(rowsJson.data) ? rowsJson.data : rowsJson;
        console.log('Row payload sample (first 2):');
        console.log(JSON.stringify(Array.isArray(list) ? list.slice(0, 2) : list, null, 2));
    } catch {
        console.log('Raw response:', rowsText.slice(0, 500));
    }
}

inspectTable().catch(err => {
    console.error('[Inspection Failed]:', err.message);
    process.exit(1);
});