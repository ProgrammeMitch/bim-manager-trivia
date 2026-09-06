const { toggleDrawer, highlightAnswer } = require('../js/ui');

describe('DOM UI Manipulation', () => {
    beforeEach(() => {
        // Scaffold a mock DOM
        document.body.innerHTML = `
            <button class="option-pill" data-option="A"></button>
            <aside id="feedback-drawer" class="drawer-hidden"></aside>
            <div id="explanation-content"></div>
        `;
    });

    it('should swap drawer classes to slide it up and inject content', () => {
        const drawer = document.getElementById('feedback-drawer');
        const contentBox = document.getElementById('explanation-content');
        
        toggleDrawer(true, "Mock Scenario Breakdown");
        
        expect(drawer.classList.contains('drawer-active')).toBe(true);
        expect(drawer.classList.contains('drawer-hidden')).toBe(false);
        expect(contentBox.innerHTML).toBe("Mock Scenario Breakdown");
    });

    it('should highlight the selected answer with the correct class', () => {
        const btn = document.querySelector('.option-pill');
        highlightAnswer(btn, true);
        expect(btn.classList.contains('correct')).toBe(true);
    });
});