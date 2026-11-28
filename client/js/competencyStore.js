const COMPETENCY_STORAGE_KEY = 'bimCompetencyProgress_v1';

function extractGuidanceKeyClient(documentName = '') {
    const match = String(documentName).trim().match(/^guidance\s+([a-z0-9]+)\b/i);
    return match ? `guidance-${match[1].toLowerCase()}` : null;
}

function getStorageBucket(userEmail) {
    const key = String(userEmail || 'guest').toLowerCase().trim();
    try {
        const all = JSON.parse(localStorage.getItem(COMPETENCY_STORAGE_KEY) || '{}');
        return all[key] || { bestQuizScores: {}, unlockedGuidances: [], completedChallenges: {} };
    } catch {
        return { bestQuizScores: {}, unlockedGuidances: [], completedChallenges: {} };
    }
}

function saveStorageBucket(userEmail, bucket) {
    const key = String(userEmail || 'guest').toLowerCase().trim();
    try {
        const all = JSON.parse(localStorage.getItem(COMPETENCY_STORAGE_KEY) || '{}');
        all[key] = bucket;
        localStorage.setItem(COMPETENCY_STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
        console.warn('[CompetencyStore] Could not persist progress:', err.message);
    }
}

/**
 * Call at the end of a quiz in engine.js.
 * Returns { newlyUnlocked: boolean, unlockThreshold: number } so the results screen can celebrate it.
 */
function recordQuizResultForUnlock(userEmail, documentName, finalScore, catalog) {
    const guidanceKey = extractGuidanceKeyClient(documentName);
    if (!guidanceKey) return { newlyUnlocked: false, unlockThreshold: catalog?.defaultUnlockScore || 2500 };

    const moduleInfo = catalog?.modules?.[guidanceKey];
    const threshold = moduleInfo?.unlockScore ?? catalog?.defaultUnlockScore ?? 2500;

    const bucket = getStorageBucket(userEmail);
    const prevBest = bucket.bestQuizScores[guidanceKey] || 0;
    bucket.bestQuizScores[guidanceKey] = Math.max(prevBest, finalScore);

    const alreadyUnlocked = bucket.unlockedGuidances.includes(guidanceKey);
    let newlyUnlocked = false;

    if (finalScore >= threshold && !alreadyUnlocked) {
        bucket.unlockedGuidances.push(guidanceKey);
        newlyUnlocked = true;
    }

    saveStorageBucket(userEmail, bucket);
    return { newlyUnlocked, unlockThreshold: threshold, guidanceKey };
}

function recordChallengeResult(userEmail, challengeId, scorecard, mortaUrl) {
    const bucket = getStorageBucket(userEmail);
    const prev = bucket.completedChallenges[challengeId];
    bucket.completedChallenges[challengeId] = {
        bestScore: Math.max(prev?.bestScore || 0, scorecard.totalScore || 0),
        passed: Boolean(prev?.passed || scorecard.passed),
        lastUrl: mortaUrl,
        updatedAt: new Date().toISOString()
    };
    saveStorageBucket(userEmail, bucket);
}

/**
 * Computes exact state and tooltip for the "Test Competency" button whenever a guidance is selected.
 */
function getCompetencyButtonState(userEmail, documentName, catalog) {
    if (!documentName) {
        return {
            enabled: false,
            locked: true,
            tooltip: 'Select an IMI Guidance module on the left to view Competency challenges.'
        };
    }

    const guidanceKey = extractGuidanceKeyClient(documentName);
    const moduleInfo = guidanceKey ? catalog?.modules?.[guidanceKey] : null;
    const threshold = moduleInfo?.unlockScore ?? catalog?.defaultUnlockScore ?? 2500;
    const bucket = getStorageBucket(userEmail);

    const bestScore = guidanceKey ? (bucket.bestQuizScores[guidanceKey] || 0) : 0;
    const unlockedByScore = guidanceKey && (bucket.unlockedGuidances.includes(guidanceKey) || bestScore >= threshold);
    const isUnlocked = Boolean(moduleInfo?.unlockedByDefault || unlockedByScore);

    if (!isUnlocked) {
        const progressNote = bestScore > 0 ? ` (Your best: ${bestScore.toLocaleString()} / ${threshold.toLocaleString()})` : '';
        return {
            enabled: false,
            locked: true,
            guidanceKey,
            threshold,
            tooltip: `Unlock by scoring ${threshold.toLocaleString()}+ on this Guidance quiz${progressNote}`
        };
    }

    if (!moduleInfo || !Array.isArray(moduleInfo.challenges) || moduleInfo.challenges.length === 0) {
        return {
            enabled: false,
            locked: false,
            comingSoon: true,
            guidanceKey,
            tooltip: 'Unlocked! Practical Morta competency challenges for this guidance are coming soon.'
        };
    }

    return {
        enabled: true,
        locked: false,
        guidanceKey,
        moduleInfo,
        tooltip: moduleInfo.unlockedByDefault
            ? `Preview access enabled — ${moduleInfo.challenges.length} challenge ready`
            : `Competency unlocked — ${moduleInfo.challenges.length} challenge(s) available`
    };
}