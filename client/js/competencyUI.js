window.competencyCatalog = null;

(function () {
    let activeModule = null;
    let activeChallenge = null;

    function getUserEmail() {
        return typeof window.getActiveBetaEmail === 'function'
            ? window.getActiveBetaEmail()
            : localStorage.getItem('betaUserEmail');
    }

    async function loadCompetencyCatalog() {
        try {
            const res = await fetch('/api/competencies');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            window.competencyCatalog = await res.json();
        } catch (err) {
            console.warn('[CompetencyUI] Catalog load failed:', err.message);
        } finally {
            refreshCompetencyButton();
        }
    }

    function refreshCompetencyButton() {
        const btn = document.getElementById('test-competency-btn');
        const label = document.getElementById('competency-btn-label');
        const tag = document.getElementById('competency-preview-tag');
        if (!btn || !label || typeof getCompetencyButtonState !== 'function') return;

        const docName = window.selectedMortaDoc?.name || null;
        const state = getCompetencyButtonState(getUserEmail(), docName, window.competencyCatalog);

        btn.setAttribute('data-tooltip', state.tooltip);
        btn.setAttribute('title', state.tooltip);
        btn.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
        btn.classList.toggle('is-locked', !state.enabled);

        if (state.enabled) {
            label.textContent = '⚡ Test Competency';
            tag?.classList.toggle('hidden', !state.moduleInfo?.unlockedByDefault);
        } else if (state.comingSoon) {
            label.textContent = '✓ Unlocked (Challenges Coming Soon)';
            tag?.classList.add('hidden');
        } else {
            label.textContent = '🔒 Test Competency';
            tag?.classList.add('hidden');
        }
    }

    function setModalScreen(screenName) {
        document.getElementById('comp-screen-brief')?.classList.toggle('hidden', screenName !== 'brief');
        document.getElementById('comp-screen-loader')?.classList.toggle('hidden', screenName !== 'loader');
        document.getElementById('comp-screen-results')?.classList.toggle('hidden', screenName !== 'results');

        document.getElementById('comp-assess-btn')?.classList.toggle('hidden', screenName !== 'brief');
        document.getElementById('comp-back-brief-btn')?.classList.toggle('hidden', screenName !== 'results');
    }

    function showModalError(message) {
        const errEl = document.getElementById('comp-error-msg');
        if (!errEl) return;
        if (!message) {
            errEl.textContent = '';
            errEl.classList.add('hidden');
        } else {
            errEl.textContent = message;
            errEl.classList.remove('hidden');
        }
    }

    function renderChallenge(challenge) {
        activeChallenge = challenge;

        document.getElementById('comp-difficulty-chip').textContent = challenge.difficulty || 'Foundation';
        document.getElementById('comp-time-chip').textContent = `~${challenge.estimatedMinutes || 8} mins`;
        document.getElementById('comp-type-chip').textContent =
            challenge.deliverableType === 'document' ? 'Morta Document' : 'Morta Table';

        document.getElementById('comp-task-title').textContent = challenge.title;
        document.getElementById('comp-task-scenario').textContent = challenge.scenario;

        const instrEl = document.getElementById('comp-task-instructions');
        instrEl.innerHTML = '';
        (challenge.instructions || []).forEach(step => {
            const li = document.createElement('li');
            li.textContent = step;
            instrEl.appendChild(li);
        });

        const colsBox = document.getElementById('comp-columns-box');
        const colsEl = document.getElementById('comp-required-columns');
        colsEl.innerHTML = '';
        if (Array.isArray(challenge.requiredColumns) && challenge.requiredColumns.length > 0) {
            colsBox.classList.remove('hidden');
            challenge.requiredColumns.forEach(col => {
                const li = document.createElement('li');
                li.textContent = col;
                colsEl.appendChild(li);
            });
        } else {
            colsBox.classList.add('hidden');
        }

        showModalError('');
    }

    function openCompetencyModal() {
        const docName = window.selectedMortaDoc?.name || null;
        const state = getCompetencyButtonState(getUserEmail(), docName, window.competencyCatalog);
        if (!state.enabled || !state.moduleInfo?.challenges?.length) return;

        activeModule = state.moduleInfo;
        document.getElementById('comp-modal-guidance').textContent = activeModule.guidanceLabel;
        document.getElementById('comp-modal-heading').textContent = 'Practical Competency Challenge';

        // Render multi-challenge switcher if this guidance has 2+ challenges
        const tabsEl = document.getElementById('comp-challenge-tabs');
        tabsEl.innerHTML = '';
        if (activeModule.challenges.length > 1) {
            tabsEl.classList.remove('hidden');
            activeModule.challenges.forEach((ch, idx) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = `timer-btn${idx === 0 ? ' active' : ''}`;
                tab.textContent = `Challenge ${idx + 1}: ${ch.title}`;
                tab.addEventListener('click', () => {
                    tabsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    tab.classList.add('active');
                    renderChallenge(ch);
                    setModalScreen('brief');
                });
                tabsEl.appendChild(tab);
            });
        } else {
            tabsEl.classList.add('hidden');
        }

        renderChallenge(activeModule.challenges[0]);
        document.getElementById('comp-morta-url').value = '';
        document.getElementById('comp-morta-key').value = '';
        document.getElementById('comp-morta-key').classList.add('hidden');
        document.getElementById('comp-open-morta-link').href = 'https://app.morta.io';

        setModalScreen('brief');
        document.getElementById('competency-modal')?.classList.remove('hidden');
    }

    function closeCompetencyModal() {
        document.getElementById('competency-modal')?.classList.add('hidden');
    }

    async function handleAssessDeliverable() {
        const email = getUserEmail();
        if (!email) {
            showModalError('Access Denied: Please open the app using your beta access link.');
            return;
        }

        const mortaUrl = document.getElementById('comp-morta-url')?.value.trim();
        const userMortaApiKey = document.getElementById('comp-morta-key')?.value.trim() || null;

        if (!mortaUrl) {
            showModalError('Please paste your Morta Table or Document URL before auditing.');
            return;
        }

        showModalError('');
        setModalScreen('loader');

        try {
            const response = await fetch('/api/competency/assess', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-email': email
                },
                body: JSON.stringify({
                    mortaUrl,
                    guidanceKey: activeModule.guidanceKey,
                    challengeId: activeChallenge.id,
                    documentId: window.selectedMortaDoc?.publicId || null,
                    userMortaApiKey
                })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || `Audit failed (HTTP ${response.status})`);
            }

            const { assessment, deliverableMeta } = payload;

            if (typeof recordChallengeResult === 'function') {
                recordChallengeResult(email, activeChallenge.id, assessment, mortaUrl);
            }

            renderScorecard(assessment, deliverableMeta, mortaUrl);
            setModalScreen('results');
        } catch (err) {
            setModalScreen('brief');
            showModalError(err.message || 'Unable to complete audit.');
        }
    }

    function renderScorecard(assessment, meta, mortaUrl) {
        document.getElementById('comp-score-number').textContent = assessment.totalScore;
        document.getElementById('comp-badge-pill').textContent = assessment.badge;

        const rowLabel = meta.rowCount !== null && meta.rowCount !== undefined
            ? ` • ${meta.rowCount} row(s)`
            : '';
        document.getElementById('comp-deliverable-meta').textContent =
            `Audited ${meta.type}: "${meta.name}"${rowLabel}`;

        const banner = document.getElementById('comp-score-banner');
        banner.classList.toggle('is-pass', Boolean(assessment.passed));
        banner.classList.toggle('is-revise', !assessment.passed);

        document.getElementById('comp-review-summary').textContent = assessment.summary;

        const criteriaList = document.getElementById('comp-criteria-list');
        criteriaList.innerHTML = '';
        (assessment.criterionResults || []).forEach(c => {
            const row = document.createElement('div');
            row.className = 'comp-criterion-row';

            const left = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = `${c.status === 'Pass' ? '✔ ' : '⚠ '}${c.name}`;
            const fb = document.createElement('p');
            fb.textContent = c.feedback;
            left.appendChild(title);
            left.appendChild(fb);

            const pts = document.createElement('div');
            pts.className = `comp-criterion-pts ${c.status === 'Pass' ? 'pass' : 'revise'}`;
            pts.textContent = `${c.score} / ${c.maxScore}`;

            row.appendChild(left);
            row.appendChild(pts);
            criteriaList.appendChild(row);
        });

        const fillList = (id, items) => {
            const ul = document.getElementById(id);
            ul.innerHTML = '';
            (items || []).forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
        };

        fillList('comp-strengths-list', assessment.strengths);
        fillList('comp-improvements-list', assessment.improvements);

        const linkBtn = document.getElementById('comp-open-morta-link');
        if (linkBtn) {
            linkBtn.href = mortaUrl;
            linkBtn.textContent = 'View Deliverable in Morta ↗';
        }
    }

    window.refreshCompetencyButton = refreshCompetencyButton;

    document.addEventListener('DOMContentLoaded', () => {
        loadCompetencyCatalog();

        document.getElementById('test-competency-btn')?.addEventListener('click', openCompetencyModal);
        document.getElementById('close-comp-modal-btn')?.addEventListener('click', closeCompetencyModal);
        document.getElementById('comp-assess-btn')?.addEventListener('click', handleAssessDeliverable);
        document.getElementById('comp-back-brief-btn')?.addEventListener('click', () => {
            document.getElementById('comp-open-morta-link').href = 'https://app.morta.io';
            document.getElementById('comp-open-morta-link').textContent = 'Open Morta ↗';
            setModalScreen('brief');
        });

        document.getElementById('comp-toggle-key-btn')?.addEventListener('click', () => {
            const keyInput = document.getElementById('comp-morta-key');
            keyInput?.classList.toggle('hidden');
            if (keyInput && !keyInput.classList.contains('hidden')) keyInput.focus();
        });

        document.getElementById('competency-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'competency-modal') closeCompetencyModal();
        });

        window.addEventListener('mortaSelectionChanged', refreshCompetencyButton);
    });
})();