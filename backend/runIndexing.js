// this file runs the complete indexing pipeline

// flow:
// 1- pdf -> gemini llm -> extract entities(convert to json format)
// 2- entities -> neo4j(graph relationships /db)
// 3- pdf-> parse text-> chunks-> embed->pinecone(vector db)

import {extractAllEntities} from "./extractAllEntities.js";
import {buildGraph} from "./graphBuilder.js"
import {buildVectoreStore} from "./vectorStore.js"
import {closeConnections} from "./config.js"

async function runIndexing(pdfPath){
    console.log(" GRAPH RAG INDEXING PIPELINE START");
    try{
        // 1- extract entities(structured data) from pdf using llm
        console.log("1- EXTRACTING ENTITIES WITH LLM + PDF PARSER")
        const entities=await extractAllEntities(pdfPath);
        // 2- build neo4j graph
        console.log("2- BUILDING GRAPH IN NEO4J");
        await buildGraph(entities);
        // 3- build vectors(parse pdf->chunk->embeds->pinecone)
        console.log("3-BUILDING VECTORE STORE (PINECONE)")
        await buildVectoreStore(pdfPath);
    } 
    catch(e){
        console.log("INDEXING FAILED",e.message);
    }
    finally{
        await closeConnections();
    }
}

const pdfPath='./movies.pdf'
if(!pdfPath){
    console.log("error to get pdf");
    process.exit(1);
}


runIndexing(pdfPath);