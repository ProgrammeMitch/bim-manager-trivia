const guidanceF = require('./modules/guidanceF');

const DEFAULT_UNLOCK_SCORE = 2500;

// Register each guidance pack here as you build them
const REGISTERED_MODULES = [
    guidanceF
];

const MODULE_MAP = new Map(
    REGISTERED_MODULES.map(mod => [mod.guidanceKey, mod])
);

/**
 * Normalizes a Morta document title like "Guidance F - Information delivery planning"
 * or "Guidance 1 - Concepts" into a stable key: "guidance-f", "guidance-1".
 */
function extractGuidanceKey(documentName = '') {
    const match = String(documentName).trim().match(/^guidance\s+([a-z0-9]+)\b/i);
    return match ? `guidance-${match[1].toLowerCase()}` : null;
}

function getCompetencyModule(guidanceKeyOrName) {
    if (!guidanceKeyOrName) return null;
    const direct = MODULE_MAP.get(String(guidanceKeyOrName).toLowerCase());
    if (direct) return direct;

    const extracted = extractGuidanceKey(guidanceKeyOrName);
    return extracted ? (MODULE_MAP.get(extracted) || null) : null;
}

function getChallengeById(guidanceKeyOrName, challengeId) {
    const mod = getCompetencyModule(guidanceKeyOrName);
    if (!mod) return null;
    return mod.challenges.find(c => c.id === challengeId) || null;
}

/**
 * Returns lightweight catalog metadata (0 tokens) for the frontend sidebar and button states.
 */
function getCompetencyCatalog() {
    const modules = {};
    for (const mod of REGISTERED_MODULES) {
        modules[mod.guidanceKey] = {
            guidanceKey: mod.guidanceKey,
            guidanceLabel: mod.guidanceLabel,
            unlockScore: mod.unlockScore ?? DEFAULT_UNLOCK_SCORE,
            unlockedByDefault: Boolean(mod.unlockedByDefault),
            challenges: mod.challenges.map(({ auditFocus, ...publicFields }) => publicFields)
        };
    }

    return {
        defaultUnlockScore: DEFAULT_UNLOCK_SCORE,
        modules
    };
}

module.exports = {
    DEFAULT_UNLOCK_SCORE,
    extractGuidanceKey,
    getCompetencyModule,
    getChallengeById,
    getCompetencyCatalog
};