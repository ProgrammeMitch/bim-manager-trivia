document.addEventListener('DOMContentLoaded', () => {
    initializeBetaAccess();

    // 1. Timer Selection Logic
    window.selectedTimeLimit = 30; // Default
    document.querySelectorAll('.timer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            window.selectedTimeLimit = parseInt(e.target.getAttribute('data-time'));
        });
    });

    // 2. Fetch Hosted Sample PDF
    const playSampleBtn = document.getElementById('play-sample-btn');
    if (playSampleBtn) {
        playSampleBtn.addEventListener('click', async () => {
            try {
                playSampleBtn.innerText = "Loading Sample...";
                const response = await fetch('../assets/sample-iso-19650.pdf');
                const blob = await response.blob();
                const sampleFile = new File([blob], "sample-iso-19650.pdf", { type: "application/pdf" });
                handleUploadAndGenerate(sampleFile);
            } catch (error) {
                console.error("Failed to load sample PDF:", error);
                alert("Could not load the sample document. Please try again.");
                playSampleBtn.innerText = "Play Saved ISO PDF";
            }
        });
    }

    const startBtn = document.getElementById('generate-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => handleUploadAndGenerate(null));
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

async function handleUploadAndGenerate(injectedFile = null) {
    const fileInput = document.getElementById('pdf-upload');
    const chunkInput = document.getElementById('chunk-input');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const startBtn = document.getElementById('generate-btn');
    const sampleBtn = document.getElementById('play-sample-btn');

    const userEmail = localStorage.getItem('betaUserEmail');
    if (!userEmail) {
        alert("Access Denied: Please use the secure beta link sent to your email.");
        return;
    }

    const fileToUpload = injectedFile || (fileInput.files && fileInput.files[0]);
    if (!fileToUpload) {
        alert("Please upload a PDF document or click 'Play Saved ISO PDF'.");
        return;
    }

    let chunkVal = parseInt(chunkInput.value) || 10;
    if (chunkVal < 5) chunkVal = 5;
    if (chunkVal > 25) chunkVal = 25;

    const formData = new FormData();
    formData.append('document', fileToUpload);
    formData.append('questionCount', chunkVal);

    progressContainer.classList.remove('hidden');
    startBtn.disabled = true;
    startBtn.textContent = "Processing...";
    progressBarFill.style.width = "0%";
    progressBarFill.style.backgroundColor = "var(--morta-blue)";

    try {
        const response = await fetch('https://bim-manager-trivia.onrender.com/upload-and-generate', {
            method: 'POST',
            headers: { 'x-user-email': userEmail },
            body: formData
        });

        if (response.status === 403) {
            const errorData = await response.json();
            alert(errorData.error);
            localStorage.removeItem('betaUserEmail');
            location.reload(); 
            return;
        }

        if (!response.body) throw new Error("ReadableStream not supported by this browser.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let isStreaming = true;

        while (isStreaming) {
            const { done, value } = await reader.read();
            if (done) {
                isStreaming = false;
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const events = chunk.split('\n\n');
            
            for (const event of events) {
                if (event.startsWith('data: ')) {
                    const jsonStr = event.substring(6);
                    if (!jsonStr.trim()) continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        
                        progressBarFill.style.width = `${parsed.progress}%`;
                        progressText.textContent = `${parsed.progress}% - ${parsed.status}`;

                        if (parsed.status === "COMPLETE") {
                            sessionStorage.setItem('bimTriviaCache', JSON.stringify(parsed.data));
                            
                            // 3. Pause Workflow: Swap buttons instead of auto-starting
                            window.generatedQuestions = parsed.data;
                            startBtn.classList.add('hidden');
                            sampleBtn.parentElement.classList.add('hidden');
                            
                            const startQuizBtn = document.getElementById('start-quiz-btn');
                            startQuizBtn.classList.remove('hidden');
                            progressText.textContent = "100% - Ready! Take a breath, then click Start.";
                            
                        } else if (parsed.status === "ERROR") {
                            throw new Error(parsed.data.message || "AI extraction failed.");
                        }
                    } catch (parseError) {
                        console.warn("[Stream Parse Warning]: Incomplete chunk received.");
                    }
                }
            }
        }
    } catch (error) {
        console.error("[Upload Error]:", error);
        progressText.textContent = `Error: ${error.message}`;
        progressBarFill.style.backgroundColor = "var(--incorrect-red)";
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = "Generate Questions";
        if(sampleBtn) sampleBtn.innerText = "Play Saved ISO PDF";
    }
}