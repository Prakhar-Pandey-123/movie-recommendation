// this file is for testing 4 services or connections :llm, neo4j, vectordb 

import { driver } from "neo4j-driver";
import { closeConnections, embedText, llm, pineconeIndex } from "./config";


async function testConnections() {
    console.log("starting test")
    // testing neo4j
    try{
        const session=driver.session();
        const result=await session.run("RETURN 'NEO4J connected' AS message ");
        console.log("neo4j",result.records[0].get("message"));
        await session.close();
    }
    catch(e){
        console.log("neo4j err",e.message);
    }

    // checking pinecone
    try{
        const stats=await pineconeIndex.describeIndexStats();
        console.log("pinecone connected");
    }
    catch(e){
        console.log("pinecone err",e.message);
    }
    // checking gemini
    try{
        const response=await llm.invoke([
            {role:"system",content:"say 'connected' and nothing else"}
        ]);
        console.log("gemini connected");
    }
    catch(e){
        console.log("gemini err",e.message);
    }
    
    //pinecone embeddings check
    try{
        const vector=await embedText("test");
        console.log("pinecone embed connected")
    } 
    catch(e){
        console.log("pinecone err",e.message);
    }

    await closeConnections();

}

testConnections();