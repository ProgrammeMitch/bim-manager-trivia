function toggleDrawer(show, content = "") {
    try {
        const drawer = document.getElementById('feedback-drawer');
        const explanationBox = document.getElementById('explanation-content');
        
        if (show) {
            drawer.classList.remove('drawer-hidden');
            drawer.classList.add('drawer-active');
            if (explanationBox) explanationBox.innerHTML = content;
        } else {
            drawer.classList.remove('drawer-active');
            drawer.classList.add('drawer-hidden');
        }
    } catch (error) {
        console.error("[UI Error - Drawer]:", error.message);
    }
}

function highlightAnswer(buttonElement, isCorrect) {
    if (!buttonElement) return;
    buttonElement.classList.add(isCorrect ? 'correct' : 'incorrect');
}

function resetButtons() {
    document.querySelectorAll('.option-pill').forEach(btn => {
        btn.classList.remove('correct', 'incorrect');
    });
}

function updateDisplays(time, score) {
    const timeEl = document.getElementById('time-left');
    const scoreEl = document.getElementById('current-score');
    
    if (timeEl) timeEl.textContent = time.toString().padStart(2, '0');
    if (scoreEl) scoreEl.textContent = score.toString().padStart(4, '0');
}

// Export for Jest testing environment, ignore in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { toggleDrawer, highlightAnswer, resetButtons, updateDisplays };
}