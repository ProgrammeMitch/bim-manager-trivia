let allMortaDocuments = [];
let selectedMortaDoc = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeBetaAccess();
    loadMortaGuidance();

    // 1. Timer Selection Logic
    window.selectedTimeLimit = 30;
    document.querySelectorAll('.timer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            window.selectedTimeLimit = parseInt(e.target.getAttribute('data-time'), 10);
        });
    });

    // 2. Search Filter for Guidance List
    const searchInput = document.getElementById('guidance-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            const filtered = allMortaDocuments.filter(doc =>
                doc.name.toLowerCase().includes(term)
            );
            renderMortaGuidanceList(filtered);
        });
    }

    // 3. Clear Guidance Selection Button
    const clearBtn = document.getElementById('clear-morta-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => clearMortaSelection());
    }

    // 4. Generate Questions Trigger
    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }
});

function initializeBetaAccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromUrl = urlParams.get('user');

    if (emailFromUrl) {
        localStorage.setItem('betaUserEmail', emailFromUrl.toLowerCase().trim());
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function loadMortaGuidance() {
    const listEl = document.getElementById('morta-guidance-list');
    if (!listEl) return;

    try {
        const res = await fetch('/api/morta/documents');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const payload = await res.json();
        allMortaDocuments = payload.documents || [];

        if (allMortaDocuments.length === 0) {
            listEl.innerHTML = '<li class="guidance-status">No guidance documents found.</li>';
            return;
        }

        renderMortaGuidanceList(allMortaDocuments);
    } catch (error) {
        console.error('[Morta Load Error]:', error);
        listEl.innerHTML = '<li class="guidance-status">Unable to load Morta guidance right now. You can still upload a PDF.</li>';
    }
}

function renderMortaGuidanceList(documents) {
    const listEl = document.getElementById('morta-guidance-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (documents.length === 0) {
        listEl.innerHTML = '<li class="guidance-status">No matching guidance found.</li>';
        return;
    }

    documents.forEach(doc => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'guidance-item';
        btn.textContent = doc.name;
        btn.dataset.docId = doc.publicId;

        if (selectedMortaDoc && selectedMortaDoc.publicId === doc.publicId) {
            btn.classList.add('selected');
        }

        btn.addEventListener('click', () => toggleMortaSelection(doc));
        li.appendChild(btn);
        listEl.appendChild(li);
    });
}

function toggleMortaSelection(doc) {
    // Clicking the active guidance item again deselects it and unlocks PDF upload
    if (selectedMortaDoc && selectedMortaDoc.publicId === doc.publicId) {
        clearMortaSelection();
        return;
    }

    selectedMortaDoc = doc;
    setPdfUploadLocked(true);

    document.getElementById('clear-morta-btn')?.classList.remove('hidden');
    document.querySelectorAll('.guidance-item').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.docId === doc.publicId);
    });
}

function clearMortaSelection() {
    selectedMortaDoc = null;
    setPdfUploadLocked(false);

    document.getElementById('clear-morta-btn')?.classList.add('hidden');
    document.querySelectorAll('.guidance-item').forEach(btn => btn.classList.remove('selected'));
}

function setPdfUploadLocked(isLocked) {
    const pdfCard = document.getElementById('pdf-upload-card');
    const pdfInput = document.getElementById('pdf-upload');
    const pdfSubtitle = document.getElementById('pdf-upload-subtitle');

    if (!pdfCard || !pdfInput) return;

    pdfCard.classList.toggle('is-disabled', isLocked);
    pdfInput.disabled = isLocked;

    if (isLocked) {
        pdfInput.value = ''; // Clear any previously selected PDF
        if (pdfSubtitle) {
            pdfSubtitle.textContent = `Locked while "${selectedMortaDoc.name}" is selected. Click Clear on the guidance panel to upload a PDF instead.`;
        }
    } else if (pdfSubtitle) {
        pdfSubtitle.textContent = 'Generate quiz questions from any BIM related PDF document or standard.';
    }
}

async function handleGenerate() {
    const fileInput = document.getElementById('pdf-upload');
    const chunkInput = document.getElementById('chunk-input');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const generateBtn = document.getElementById('generate-btn');

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let userEmail = localStorage.getItem('betaUserEmail');

    if (isLocal && !userEmail) {
        userEmail = 'mitchmbagha@gmail.com';
    }

    if (!userEmail) {
        alert('Access Denied: Please use the secure beta link sent to your email.');
        return;
    }

    let chunkVal = parseInt(chunkInput.value, 10) || 10;
    if (chunkVal < 5) chunkVal = 5;
    if (chunkVal > 25) chunkVal = 25;
    chunkInput.value = chunkVal;

    const uploadedFile = fileInput.files && fileInput.files[0];

    if (!selectedMortaDoc && !uploadedFile) {
        alert('Please select a Morta Guidance module or upload a PDF document to begin.');
        return;
    }

    // Lock UI during generation
    progressContainer.classList.remove('hidden');
    generateBtn.disabled = true;
    generateBtn.textContent = 'Processing...';
    progressBarFill.style.width = '0%';
    progressBarFill.style.backgroundColor = 'var(--morta-blue)';
    progressText.textContent = '0% - Starting generation...';

    try {
        let response;

        if (selectedMortaDoc) {
            response = await fetch('/generate-from-morta', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-email': userEmail
                },
                body: JSON.stringify({
                    documentId: selectedMortaDoc.publicId,
                    questionCount: chunkVal
                })
            });
        } else {
            const formData = new FormData();
            formData.append('document', uploadedFile);
            formData.append('questionCount', chunkVal);

            response = await fetch('/upload-and-generate', {
                method: 'POST',
                headers: { 'x-user-email': userEmail },
                body: formData
            });
        }

        if (response.status === 403) {
            const errorData = await response.json();
            alert(errorData.error);
            localStorage.removeItem('betaUserEmail');
            location.reload();
            return;
        }

        if (!response.body) {
            throw new Error('ReadableStream not supported by this browser.');
        }

        await readSSEStream(response, { progressBarFill, progressText, generateBtn });
    } catch (error) {
        console.error('[Generation Error]:', error);
        progressText.textContent = `Error: ${error.message}`;
        progressBarFill.style.backgroundColor = 'var(--incorrect-red)';
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Questions';
    }
}

async function readSSEStream(response, { progressBarFill, progressText, generateBtn }) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');

        while (boundary !== -1) {
            const eventStr = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            if (eventStr.startsWith('data: ')) {
                const jsonStr = eventStr.substring(6).trim();
                if (jsonStr) {
                    const parsed = JSON.parse(jsonStr);
                    progressBarFill.style.width = `${parsed.progress}%`;
                    progressText.textContent = `${parsed.progress}% - ${parsed.status}`;

                    if (parsed.status === 'COMPLETE') {
                        sessionStorage.setItem('bimTriviaCache', JSON.stringify(parsed.data));
                        window.generatedQuestions = parsed.data;

                        generateBtn.classList.add('hidden');
                        document.getElementById('start-quiz-btn')?.classList.remove('hidden');
                        progressText.textContent = '100% - Ready! Take a breath, then click Start.';
                    } else if (parsed.status === 'ERROR') {
                        throw new Error(parsed.data?.message || 'AI extraction failed.');
                    }
                }
            }

            boundary = buffer.indexOf('\n\n');
        }
    }
}