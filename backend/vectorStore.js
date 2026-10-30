// 
// vectorStore.js — PDF → Chunks → Embeddings → Pinecone
//
// FLOW:
//   1. Parse PDF → raw text
//   2. Split text into chunks (by separator)
//   3. Embed each chunk using Gemini Embeddings API (gemini-embedding-001)
//   4. Upsert to Pinecone


import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { embedText, pineconeIndex } from "./2_config.js";

// ── Constants ──
const EMBED_CONCURRENCY = 3;
const EMBED_DELAY_MS = 500;
const UPSERT_BATCH_SIZE = 100;

// 
// STEP 1: Parse PDF → Raw Text(bring it locally)
// 
async function parsePDF(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdf(buffer);
  console.log(`Parsed PDF: ${data.numpages} pages, ~${data.text.length} characters`);
  return data.text;
}

// STEP 2: Chunk Text

function chunkText(rawText) {
  const blocks = rawText.split(/\n-{5,}\n/);

  const chunks = [];
  for (const block of blocks) {
    const text = block.trim();
    if (!text || text.length < 10) continue;
    chunks.push(text);
  }

  return chunks;
}

// 
// STEP 3: Embed(create vectors)
// 
async function embedChunk(text) {
  try {
    return await embedText(text);
  } catch (err) {
    console.error(`   ❌ Embed failed:`, err.message?.substring(0, 100));
    return null;
  }
}

// MAIN: Parse → Chunk → Embed → Upsert
// 
async function buildVectorStore(pdfPath) {
  console.log(`Building vector store from PDF`);
  console.log(`Concurrency: ${EMBED_CONCURRENCY} parallel embeddings\n`);

  const startTime = Date.now();

  // Step 1: Parse PDF
  console.log("Step 1: Parsing PDF...");
  const rawText = await parsePDF(pdfPath);

  // Step 2: Chunk
  console.log("Step 2: Chunking text...");
  const chunks = chunkText(rawText);
  console.log(`Created ${chunks.length} chunks`);

  if (chunks.length === 0) {
    console.error("No chunks created! Check PDF format.");
    return;
  }

  // Step 3: Embed all chunks (5 concurrent)
  console.log(`Step 3: Embedding ${chunks.length} chunks...`);

  const vectors = []; // { id, values, metadata }
  let failCount = 0;

  for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
    const batch = chunks.slice(i, i + EMBED_CONCURRENCY);
    const roundNum = Math.floor(i / EMBED_CONCURRENCY) + 1;
    const totalRounds = Math.ceil(chunks.length / EMBED_CONCURRENCY);

    if ((roundNum - 1) % 10 === 0 || roundNum === totalRounds) {
      console.log(`Round ${roundNum}/${totalRounds} (chunks ${i + 1}-${Math.min(i + EMBED_CONCURRENCY, chunks.length)})...`);
    }

    const results = await Promise.all(
      batch.map(async (text, j) => {
        const embedding = await embedChunk(text);
        if (!embedding) return null;
        return {
          id: `chunk-${i + j}`,
          values: embedding,
          metadata: { text },
        };
      })
    );

    for (const r of results) {
      if (r) vectors.push(r);
      else failCount++;
    }

    // Rate limit pause between rounds
    if (i + EMBED_CONCURRENCY < chunks.length) {
      await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
    }
  }

  const embedTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Embedded ${vectors.length}/${chunks.length} in ${embedTime}s (${failCount} failed)`);

  if (vectors.length === 0) {
    console.error("No vectors to upsert!");
    return;
  }

  // Step 4: Upsert to Pinecone

  console.log(`Step 4: Upserting to Pinecone...`);
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
    const batchNum = Math.floor(i / UPSERT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vectors.length / UPSERT_BATCH_SIZE);

    console.log(` Batch ${batchNum}/${totalBatches} (${batch.length} vectors)...`);

    // Pinecone v5: .upsert() takes an array of vectors directly
    await pineconeIndex.upsert(batch);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = await pineconeIndex.describeIndexStats();
  console.log(`Vector store built in ${totalTime}s! Total vectors: ${stats.totalRecordCount}`);
}

export { buildVectorStore };