const Tesseract = require('tesseract.js');
const fs = require('fs');

async function doOCR() {
    console.log("Starting OCR...");
    const { data: { text } } = await Tesseract.recognize(
        'C:/Users/tony_/.gemini/antigravity/brain/1b5f6a5d-1a14-4029-a482-516b34bccc84/.user_uploaded/media_1787263795537.png',
        'deu' // German
    );
    console.log("--- OCR OUTPUT ---");
    console.log(text);
    console.log("------------------");
    
    fs.writeFileSync('ocr_output.txt', text);
}

doOCR();
