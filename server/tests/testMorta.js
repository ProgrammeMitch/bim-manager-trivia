const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const API_KEY = process.env.Morta_Educational_Concept;
const HUB_ID = 'a690e3a3-aa56-4a14-bb59-887f9c743b31';
const DOC_ID = 'db8ec703-d234-45b5-82fd-41353431598a';

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Accept': 'application/json'
};

// Extract plain text from Morta's Draft.js description object
function extractDraftJsText(description) {
    const blocks = description?.content?.blocks;
    if (!Array.isArray(blocks)) return '';

    return blocks
        .map(block => (block.text || '').trim())
        .filter(Boolean)
        .join('\n');
}

// Recursively walk nested document sections
function flattenSections(sections = [], parentPath = '', results = []) {
    // Sort by position so sections stay in reading order
    const sorted = [...sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    for (const section of sorted) {
        if (section.isDeleted) continue;

        const heading = parentPath ? `${parentPath} > ${section.name}` : section.name;
        const text = extractDraftJsText(section.description);
        const entityKeys = Object.keys(section.description?.content?.entityMap || {});

        if (text.length > 0) {
            results.push({
                id: section.publicId,
                heading,
                text,
                charCount: text.length,
                embeddedEntities: entityKeys.length
            });
        }

        if (Array.isArray(section.children) && section.children.length > 0) {
            flattenSections(section.children, heading, results);
        }
    }

    return results;
}

async function testMortaDocument() {
    if (!API_KEY) {
        console.error('Missing Morta_Educational_Concept in .env');
        process.exit(1);
    }

    try {
        console.log(`Fetching document ${DOC_ID}...`);
        const docRes = await fetch(`https://api.morta.io/v1/document/${DOC_ID}`, { headers });

        if (!docRes.ok) {
            const errBody = await docRes.text();
            console.error(`Document fetch failed (${docRes.status}):`, errBody);
            return;
        }

        const docJson = await docRes.json();
        const doc = docJson.data;

        console.log(`\nDocument Name: ${doc.name}`);
        console.log(`Hub Name: ${doc.projectName}`);

        const sections = flattenSections(doc.children);
        const totalChars = sections.reduce((sum, s) => sum + s.charCount, 0);

        console.log(`Extracted Sections with Text: ${sections.length}`);
        console.log(`Total Characters Extracted: ${totalChars}`);

        // Preview the first 3 non-empty sections
        console.log('\n--- Sample Extracted Sections ---');
        sections.slice(0, 3).forEach((s, i) => {
            console.log(`\n[${i + 1}] ${s.heading} (ID: ${s.id} | ${s.charCount} chars | Entities: ${s.embeddedEntities})`);
            console.log(s.text.slice(0, 300) + (s.text.length > 300 ? '...' : ''));
        });

        // Also list other documents in the IMI Framework hub
        console.log(`\n--- Checking All Documents in Hub ${HUB_ID} ---`);
        const hubDocsRes = await fetch(`https://api.morta.io/v1/hub/${HUB_ID}/documents`, { headers });
        if (hubDocsRes.ok) {
            const hubDocsJson = await hubDocsRes.json();
            const activeDocs = (hubDocsJson.data || []).filter(d => !d.isDeleted);
            console.log(`Total Active Documents in Hub: ${activeDocs.length}`);
            activeDocs.slice(0, 10).forEach(d => {
                console.log(` - ${d.name} (${d.publicId})`);
            });
        } else {
            console.log(`Hub documents check returned ${hubDocsRes.status}`);
        }
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testMortaDocument();