// 1. Declare the mock function with the 'mock' prefix so Jest allows it inside the factory
const mockCreate = jest.fn();

// 2. Define the mock factory BEFORE requiring the service
jest.mock('openai', () => {
    return {
        OpenAI: jest.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockCreate
                }
            }
        }))
    };
});

// 3. Now require the service, which will use the fully structured mock above
const { generateQuestionFromChunk } = require('../services/agentService');

describe('AI Agent Service', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should parse and return a valid JSON question object', async () => {
        const mockAIResponse = {
            question: "What is the primary purpose of a Common Data Environment (CDE)?",
            options: { A: "Storage", B: "Collaboration", C: "Rendering", D: "Drafting" },
            correctAnswer: "B",
            explanation: "Core Principle: ..."
        };

        mockCreate.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify(mockAIResponse) } }]
        });

        const result = await generateQuestionFromChunk("BIM facts regarding CDE...");
        expect(result.question).toBe("What is the primary purpose of a Common Data Environment (CDE)?");
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should safely return a NO_FACTS status for filler text', async () => {
        mockCreate.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({ status: "NO_FACTS" }) } }]
        });

        const result = await generateQuestionFromChunk("Welcome to chapter one.");
        expect(result.status).toBe("NO_FACTS");
    });
});