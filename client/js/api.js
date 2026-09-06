document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', handleUploadAndGenerate);
    }
});

async function handleUploadAndGenerate() {
    const fileInput = document.getElementById('pdf-upload');
    const countInput = document.getElementById('question-count');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const startBtn = document.getElementById('start-btn');

    if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please upload a PDF document to begin.");
        return;
    }

    // 1. Prepare Payload & Lock UI
    const formData = new FormData();
    formData.append('document', fileInput.files[0]);
    formData.append('questionCount', countInput.value);

    progressContainer.classList.remove('hidden');
    startBtn.disabled = true;
    startBtn.textContent = "Processing...";
    progressBarFill.style.width = "0%";
    progressBarFill.style.backgroundColor = "var(--gold-accent)";

    try {
        // 2. Open Stream via POST request (Make sure your backend is running on port 3000)
        const response = await fetch('http://localhost:3000/upload-and-generate', {
            method: 'POST',
            body: formData
        });

        if (!response.body) throw new Error("ReadableStream not supported by this browser.");

        // 3. Read the continuous SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let isStreaming = true;

        while (isStreaming) {
            const { done, value } = await reader.read();
            if (done) {
                isStreaming = false;
                break;
            }

            // Decode the byte array into a string
            const chunk = decoder.decode(value, { stream: true });
            
            // SSE streams separate events with double newlines
            const events = chunk.split('\n\n');
            
            for (const event of events) {
                if (event.startsWith('data: ')) {
                    const jsonStr = event.substring(6);
                    if (!jsonStr.trim()) continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        
                        // 4. Update UI Progress
                        progressBarFill.style.width = `${parsed.progress}%`;
                        progressText.textContent = `${parsed.progress}% - ${parsed.status}`;

                        // 5. Handle Completion or Error
                        if (parsed.status === "COMPLETE") {
                            // Cache locally so the user can disconnect from the internet and keep playing
                            sessionStorage.setItem('bimTriviaCache', JSON.stringify(parsed.data));
                            
                            // Handoff to app.js
                            if (typeof window.initGame === 'function') {
                                window.initGame(parsed.data);
                            }
                        } else if (parsed.status === "ERROR") {
                            throw new Error(parsed.data.message || "AI extraction failed.");
                        }
                    } catch (parseError) {
                        // Ignore fragments that got split mid-transmission; the next chunk will complete them
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
    }
}