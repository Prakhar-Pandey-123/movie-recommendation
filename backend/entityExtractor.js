// 
//entityExtractor.js — PDF → Parse → Gemini LLM → JSON

// Parse PDF locally with pdf-parse → split into batches of movies → send text to Gemini LLM for entity extraction.
// FLOW:
//   1. Parse PDF → raw text
//   2. Split text by movie separators
//   3. Send batches of movie text to Gemini LLM for structured extraction
//   4. Collect all extracted entities
//
// NOTE: Gemini is configured in JSON mode (responseMimeType in config.js),
// so responses come back as raw JSON with no markdown fences.


import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { llm } from "./config.js";

const EXTRACTION_PROMPT = `You are a precise entity extractor for a movie knowledge graph.
From the movie entries below, extract movies {START} through {END} (by their order in the doc).
For EACH movie, output this EXACT JSON structure:
{
  "movie": {"title": "string", "year": number},
  "director": {"name": "string"},
  "actors": ["string"],
  "genres": ["string"],
  "themes": ["string"],
  "awards": ["string"]
}
Rules:
- If awards say "None", return awards as empty array []
- Keep exact names as written in the PDF
- Year must be a number, not string
- Return a JSON ARRAY of objects: [{...}, {...}, ...]`;

/**
 * Parse PDF → raw text using pdf-parse.
 */
async function parsePDF(pdfPath) {
  console.log("Parsing PDF locally...");
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdf(buffer);
  console.log(`pdf parsed`);
  return data.text;
}

/**
 * Split raw PDF text into individual movie blocks.
 * Each movie is separated by a line of dashes (-----).
 */
function splitMovieBlocks(rawText) {
  const blocks = rawText.split(/\n-{5,}\n/);
  const movieBlocks = [];
  for (const block of blocks) {
    const text = block.trim();
    if (!text || text.length < 10) continue;
    movieBlocks.push(text);
  }
  return movieBlocks;
}

/**
 * Extract one batch of movies by sending their text to Gemini LLM.
 * Gemini is in JSON mode, so the response is already valid JSON.
 * If the call or JSON parsing fails, the batch is logged and an empty
 * array is returned (no retries).
 */
async function extractBatch(movieTexts, batchStart) {
  const batchEnd = batchStart + movieTexts.length - 1;

  const prompt = `${EXTRACTION_PROMPT.replace("{START}", batchStart).replace("{END}", batchEnd)}

Here are the movie entries:

${movieTexts.join("\n-----\n")}`;

  try {
    const response = await llm.invoke([
      { role: "system", content: "You are a precise entity extractor. Return ONLY a valid JSON array." },
      { role: "human", content: prompt },
    ]);

    const parsed = JSON.parse(response.content);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error(`Batch ${batchStart}-${batchEnd} FAILED:`, err.message?.substring(0, 150));
    return [];
  }
}

/**
 * Extract ALL entities from PDF.
 *
 * STRATEGY:
 *   - Parse PDF locally with pdf-parse
 *   - Split into individual movie blocks
 *   - Send batches to Gemini LLM for extraction
 *   - Run 3 batches in PARALLEL
 */
async function extractAllEntities(pdfPath, totalMovies = 26, batchSize = 5) {
    // batch means group of movies
  // Parse PDF locally
  const rawText = await parsePDF(pdfPath);
  const movieBlocks = splitMovieBlocks(rawText);

  console.log(`Found ${movieBlocks.length} movie blocks in PDF`);

  // Use actual count if fewer than expected
  const actualMovies = Math.min(totalMovies, movieBlocks.length);

  const allBatches = [];
  const totalBatches = Math.ceil(actualMovies / batchSize);

  // Build batch(group of movies) list,by telling start and end index 
  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const end = Math.min((i + 1) * batchSize, actualMovies);
    allBatches.push({
      startIdx: start,
      endIdx: end,
      movieNum: start + 1,
    });
  }

  // ── Run 3 batches in parallel ──
  const CONCURRENCY = 3;
  const results = [];

  console.log(`Extracting ${totalBatches} batches of ${batchSize} movies (${CONCURRENCY} parallely)...\n`);

  for (let i = 0; i < allBatches.length; i += CONCURRENCY) {
    const chunk = allBatches.slice(i, i + CONCURRENCY);
    const roundNum = Math.floor(i / CONCURRENCY) + 1;
    const totalRounds = Math.ceil(allBatches.length / CONCURRENCY);

    console.log(`Round ${roundNum}/${totalRounds}: Movies ${chunk[0].movieNum}-${chunk[chunk.length - 1].endIdx}...`);

    // Fire all requests at the same time
    const promises = chunk.map((batch) => {
      const texts = movieBlocks.slice(batch.startIdx, batch.endIdx);
      return extractBatch(texts, batch.movieNum);
    });

    const batchResults = await Promise.all(promises);

    for (const res of batchResults) {
      results.push(...res);
    }
  }

  console.log(`Total extracted: ${results.length}/${actualMovies} movies`);
  if (results.length < actualMovies) {
    console.warn(`${actualMovies - results.length} movies missing. You can re-run indexing to fill gaps.`);
  }

  return results;
}

export { extractAllEntities };