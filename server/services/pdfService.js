const fs = require('fs');
const pdfExtract = require('pdf-extraction');

async function extractAndDiscardPDF(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error("File does not exist at the provided path.");
        }

        const dataBuffer = fs.readFileSync(filePath);
        
        // pdf-extraction uses the exact same promise-based API
        const parsedData = await pdfExtract(dataBuffer);
        
        // Immediately discard the file from temporary storage
        fs.unlinkSync(filePath);

        return parsedData.text;
    } catch (error) {
        // Ensure cleanup occurs even if parsing fails
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        console.error("[PDF Service Error]:", error.message);
        throw new Error("Failed to parse and discard PDF document.");
    }
}

module.exports = { extractAndDiscardPDF };