const { OpenAI } = require('openai');
const { getBIMManagerPrompt } = require('../utils/prompts');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

async function generateQuestionFromChunk(chunk) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o', // Adjust model as needed (e.g., gpt-4-turbo)
            messages: [
                { role: 'system', content: getBIMManagerPrompt() },
                { role: 'user', content: chunk }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3, // Kept low to prioritize factual accuracy over creativity
        });

        const content = response.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("[Agent Service Error]:", error.message);
        throw new Error("Failed to generate or parse question from AI agent.");
    }
}

module.exports = { generateQuestionFromChunk };