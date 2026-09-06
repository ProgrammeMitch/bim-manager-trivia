/**
 * Calculates points based on the time remaining on the clock.
 * @param {number} timeRemaining - The seconds left on the timer when the answer is selected.
 * @param {number} maxTime - The total time allotted for the question (default 10).
 * @returns {number} The calculated points.
 */
function calculatePoints(timeRemaining, maxTime = 10) {
    try {
        if (timeRemaining < 0) return 0;
        if (timeRemaining > maxTime) return maxTime;
        
        return Math.floor(timeRemaining);
    } catch (error) {
        console.error("[Engine Error]:", error.message);
        return 0;
    }
}

/**
 * Adds the earned points to the total score.
 * @param {number} currentScore - The user's current total score.
 * @param {number} earnedPoints - The points earned from the current question.
 * @returns {number} The new total score.
 */
function updateScore(currentScore, earnedPoints) {
    return currentScore + earnedPoints;
}

// Export for Node/Jest testing environment, but ignore in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculatePoints, updateScore };
}