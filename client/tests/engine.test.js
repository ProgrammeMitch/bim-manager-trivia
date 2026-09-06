const { calculatePoints, updateScore } = require('../js/engine');

describe('Game Scoring Engine', () => {
    it('should award maximum points for immediate answers', () => {
        expect(calculatePoints(10, 10)).toBe(10);
    });

    it('should award points equal to the time remaining', () => {
        // 8 seconds elapsed, 2 seconds remaining
        expect(calculatePoints(2, 10)).toBe(2);
        // 4 seconds elapsed, 6 seconds remaining
        expect(calculatePoints(6, 10)).toBe(6);
    });

    it('should award 0 points if time runs out', () => {
        expect(calculatePoints(0, 10)).toBe(0);
    });

    it('should correctly accumulate the total score', () => {
        let currentScore = 0;
        currentScore = updateScore(currentScore, 10);
        currentScore = updateScore(currentScore, 6);
        expect(currentScore).toBe(16);
    });
});