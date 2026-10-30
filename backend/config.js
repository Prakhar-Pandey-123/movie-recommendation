import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
});



export async function embedText(text, taskType = "RETRIEVAL_DOCUMENT") {
  const res = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { taskType, outputDimensionality: 1024 },
  });

  // Gemini only returns normalized vectors at its full 3072 size,
  // so normalize manually when using a smaller size.
  const values = res.embeddings[0].values;
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}