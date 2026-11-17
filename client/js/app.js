let gameState = {
    questions: [],
    currentIndex: 0,
    score: 0,
    timeLimit: 30, // Base timer dynamically populated 
    timeRemaining: 30,
    timerId: null,
    isAnswering: false
};

// 1. Hook up the new manual start button
document.addEventListener('DOMContentLoaded', () => {
    const startQuizBtn = document.getElementById('start-quiz-btn');
    if(startQuizBtn) {
        startQuizBtn.addEventListener('click', () => {
            // Pull the time limit selected in api.js, default to 30 if null
            const selectedTime = window.selectedTimeLimit || 30;
            initGame(window.generatedQuestions, selectedTime);
        });
    }
});

// Re-engineered initGame to accept the selected time limit
window.initGame = function(fetchedQuestions, timeLimit = 30) {
    gameState.questions = fetchedQuestions;
    gameState.currentIndex = 0;
    gameState.score = 0;
    gameState.timeLimit = timeLimit;
    
    document.getElementById('upload-view').classList.replace('active', 'hidden');
    document.getElementById('game-view').classList.replace('hidden', 'active');
    
    loadNextQuestion();
};

function loadNextQuestion() {
    if (gameState.currentIndex >= gameState.questions.length) {
        return showResults();
    }

    gameState.isAnswering = false;
    // Reset remaining time to the user's chosen limit
    gameState.timeRemaining = gameState.timeLimit; 
    
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
        // Dynamic Multiplier Scoring
        let multiplier = 1; // 30s tier
        if (gameState.timeLimit === 20) multiplier = 2;
        if (gameState.timeLimit === 10) multiplier = 3;

        // Note: calculatePoints needs to be updated in engine.js to handle the multiplier, 
        // or calculated here directly. Let's calculate it directly to be safe:
        let earned = (100 + (gameState.timeRemaining * 10)) * multiplier;
        
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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('next-question-btn')?.addEventListener('click', () => {
        if (typeof toggleDrawer === 'function') toggleDrawer(false); 
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