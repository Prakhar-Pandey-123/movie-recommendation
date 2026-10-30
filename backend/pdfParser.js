// this is for pdf->raw text blocks

// read pdf file from disk(binary bytes)
// extract all text from pages
// split by dash seperator into individual movie blocks
// Input:  "./data/movies.pdf"
// Output: ["Movie Title: Movie 0001\n...", "Movie Title: Movie 0002\n...", ...]

import fs from "fs"
import pdf from "pdf-parse";

async function parsePDF(pdfPath) {
    // read pdf as binary data
    const dataBuffer=fs.readFileSync(pdfPath);
    // extract all text
    const pdfData=await pdf(dataBuffer)
    const rawText=pdfData.text;

    // split by seperator(10+ dashes)
    const movieBlocks=rawText.split(/-{10,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0 && block.includes("Movie Title"));
    
    console.log(`found ${movieBlocks.length} movie blocks`);
    return movieBlocks;
}


export {parsePDF};