let gameState = {
    questions: [],
    currentIndex: 0,
    score: 0,
    timeRemaining: 10,
    timerId: null,
    isAnswering: false
};

// Expose globally to be called by api.js once extraction is complete
window.initGame = function(fetchedQuestions) {
    gameState.questions = fetchedQuestions;
    gameState.currentIndex = 0;
    gameState.score = 0;
    
    document.getElementById('upload-view').classList.replace('active', 'hidden');
    document.getElementById('game-view').classList.replace('hidden', 'active');
    
    loadNextQuestion();
};

function loadNextQuestion() {
    // Replaced location.reload() with state routing
    if (gameState.currentIndex >= gameState.questions.length) {
        return showResults();
    }

    gameState.isAnswering = false;
    gameState.timeRemaining = 10;
    
    if (typeof resetButtons === 'function') resetButtons();
    if (typeof toggleDrawer === 'function') toggleDrawer(false);
    if (typeof updateDisplays === 'function') updateDisplays(gameState.timeRemaining, gameState.score);

    const q = gameState.questions[gameState.currentIndex];
    document.getElementById('question-tracker').textContent = `QUESTION ${gameState.currentIndex + 1} / ${gameState.questions.length}`;
    document.getElementById('question-text').textContent = q.question;
    
    const btns = document.querySelectorAll('.option-pill');
    btns.forEach((btn, index) => {
        const optKey = Object.keys(q.options)[index];
        btn.dataset.option = optKey;
        btn.querySelector('.opt-text').textContent = q.options[optKey];
        
        // Clone and replace to strip old event listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => handleSelection(newBtn, optKey, q));
    });

    startTimer();
}

function startTimer() {
    clearInterval(gameState.timerId);
    gameState.timerId = setInterval(() => {
        gameState.timeRemaining--;
        if (typeof updateDisplays === 'function') updateDisplays(gameState.timeRemaining, gameState.score);
        
        if (gameState.timeRemaining <= 0) {
            clearInterval(gameState.timerId);
            handleTimeOut();
        }
    }, 1000);
}

function handleSelection(btn, selectedOpt, questionData) {
    if (gameState.isAnswering) return;
    gameState.isAnswering = true;
    clearInterval(gameState.timerId);

    const isCorrect = selectedOpt === questionData.correctAnswer;
    if (typeof highlightAnswer === 'function') highlightAnswer(btn, isCorrect);

    if (isCorrect) {
        const earned = typeof calculatePoints === 'function' ? calculatePoints(gameState.timeRemaining, 10) : 0;
        gameState.score = typeof updateScore === 'function' ? updateScore(gameState.score, earned) : gameState.score + earned;
        if (typeof updateDisplays === 'function') updateDisplays(gameState.timeRemaining, gameState.score);
    }

    const feedbackHeader = isCorrect ? '<span style="color: var(--correct-green)">CORRECT!</span>' : '<span style="color: var(--incorrect-red)">INCORRECT.</span>';
    const explanationHtml = `<strong>${feedbackHeader}</strong><br><br>${questionData.explanation.replace(/\n/g, '<br>')}`;
    
    if (typeof toggleDrawer === 'function') toggleDrawer(true, explanationHtml);
}

function handleTimeOut() {
    gameState.isAnswering = true;
    const q = gameState.questions[gameState.currentIndex];
    const explanationHtml = `<strong><span style="color: var(--incorrect-red)">TIME'S UP!</span></strong><br><br>${q.explanation.replace(/\n/g, '<br>')}`;
    if (typeof toggleDrawer === 'function') toggleDrawer(true, explanationHtml);
}

function showResults() {
    document.getElementById('game-view').classList.replace('active', 'hidden');
    document.getElementById('results-view').classList.replace('hidden', 'active');
    document.getElementById('final-score-display').textContent = `${gameState.score} PTS`;
}

function retakeQuiz() {
    // Shuffle the cached array so the retake isn't in the exact same order
    for (let i = gameState.questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.questions[i], gameState.questions[j]] = [gameState.questions[j], gameState.questions[i]];
    }

    gameState.currentIndex = 0;
    gameState.score = 0;
    
    document.getElementById('results-view').classList.replace('active', 'hidden');
    document.getElementById('game-view').classList.replace('hidden', 'active');
    
    loadNextQuestion();
}

// Bind Global Navigation & Reset Buttons
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('next-question-btn')?.addEventListener('click', () => {
        if (typeof toggleDrawer === 'function') toggleDrawer(false); // Force drawer closed on next
        gameState.currentIndex++;
        loadNextQuestion();
    });
    
    document.getElementById('close-drawer-btn')?.addEventListener('click', () => {
        if (typeof toggleDrawer === 'function') toggleDrawer(false);
        gameState.currentIndex++;
        loadNextQuestion();
    });

    document.getElementById('retake-btn')?.addEventListener('click', retakeQuiz);
    document.getElementById('new-pdf-btn')?.addEventListener('click', () => location.reload());
});
