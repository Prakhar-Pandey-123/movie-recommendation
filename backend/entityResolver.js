// this file is for extracting entities and resolve them.this runs for every user query
// eg-user says "dicaprio"-is that an actor?director?movie?
// user says "nolan"- is this actor?director?movie?
// user says "inception"- same question

// flow:
// step 1: llm extracts entity name from query
// eg-"action movies with tom"->["action","tom"]
// step2: for each entity-search all nodes in graph ,tom->actor/director/movie/genre
// action->genre/actor/director/movie
// step3: this fn will return resolved entity
//  { name: "Tom Hardy", searchTerm: "Tom Hardy", label: "Actor", nodeName: "Tom Hardy" },


//  FUZZY MATCHING:
//   User might say "Nolan" but graph has "Christopher Nolan".
//   We use CONTAINS for partial matching.
//   If exact match exists, prefer it over partial match.



// all approach---->
// 1. Exact Matching
// Checks whether the user's query exactly matches the node's stored name.
// Implementation: Use a Cypher WHERE condition with =

// 2. Vector Search
// Converts node information into embeddings and stores them in Pinecone. The user's query is also converted into an embedding, and similarity search retrieves the closest matching nodes.

// 3. Alias Matching
// Stores alternative names, nicknames, abbreviations, and commonly used variations directly as node properties.
// Implementation: Maintain an aliases array on each node.

// 4. Fuzzy Matching
// Finds approximate matches even when the user makes spelling mistakes or small typing errors.
// Implementation: Use Levenshtein distance through Neo4j APOC or a Node.js fuzzy-matching library such as Fuse.js.

import { llm,driver } from "./config";

// known values for llm based spelling correction
const KNOWN_VALUES={
    Genre:["Action", "Adventure", "Crime", "Drama", "Fantasy", "Horror", "Mystery", "Psychological Thriller", "Romance", "Sci-Fi", "Thriller"],
    Theme:["Corruption", "Dreams", "Fate", "Freedom", "Hope", "Identity", "Isolation", "Love", "Memory", "Morality", "Power", "Reality", "Survival", "Technology", "Time"]
}

//llm based spelling correction-
// romantic->romance ,scifi->Sci-Fi,scary->horror 
async function correctSpelling(term){
    const response=await llm.invoke([
        {
            role:"system",
            content:`you correct misspelled or informal movie-related terms to their exact database values
            KNOWN GENRES:${KNOWN_VALUES.Genre.join(",")}
            KNOWN_THEMES:${KNOWN_VALUES.Theme.join(",")}
            If the term matches or is close to a genre or theme, return the EXACT value from the lists above.
            If no match is possible, return "NONE". No explanation, no quotes, no extra text.

            Examples:
            "romantic" → Romance
            "sifi" → Sci-Fi
            "xyz123" → NONE
            `
        },{
            role:'human',content:term
        }
    ]);
    let corrected=response.content;
    if(Array.isArray(corrected)){
        corrected=corrected.filter((b) => typeof b === "string" || b.type === "text")
        .map((b) => (typeof b === "string" ? b : b.text))
        .join("");
    }
    corrected=corrected.trim();
    if(corrected==='NONE'|| corrected.length===0) return null;
    return corrected;
}

// all 'nodes types' in our graph
const NODE_TYPES = [
  { label: "Movie", property: "title" },
  { label: "Director", property: "name" },
  { label: "Actor", property: "name" },
  { label: "Genre", property: "name" },
  { label: "Theme", property: "name" },
  { label: "Award", property: "name" },
];

// llm extracts entity name from query
async function extractEntities(query) {
    const response=await llm.invoke([
        {
            role:"system",
            content:`you extract entity name from movie-related queries
            extract all names,titles and specific terms from the query.
            Do NOT extract generic words like "movies", "recommend", "find", "show".
            Do NOT extract adjectives like "good", "best", "latest".
            DO extract: person names, movie titles, genre names, theme names, award names.

            Respond ONLY with a JSON array of strings. No markdown, no backticks.

            Examples:
            "Movies directed by Christopher Nolan" → ["Christopher Nolan"]
            "Action movies with Tom Hardy" → ["Action", "Tom Hardy"]
            "How is DiCaprio related to Nolan?" → ["DiCaprio", "Nolan"]
            "Tell me about Inception" → ["Inception"]
            "Movies like Inception" → ["Inception"]
            "Sci-fi movies that won Oscar" → ["Sci-fi", "Oscar"]
            "Recommend me a good thriller" → ["thriller"]
            "Movies about dreams and reality" → ["dreams", "reality"]`,
                },
                { role: "human", content: query },
            ]);
    let raw=response.content;
    if(Array.isArray(raw)){
        raw=raw.filter((block) => typeof block === "string" || block.type === "text")
        .map((block) => (typeof block === "string" ? block : block.text))
        .join("\n");
    }
    raw=raw.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try{
        return JSON.parse(raw);
    }
    catch(e){
        console.log('entity extractor failed',e);
        return [];
    }
}


// find the entity in neo4j
// 1.try exact match first: Nolan:'Nolan'
// 2.if no exact match,try CONTAINS:nolan CONTAINS in christopher nolan
// 3.if multiple matches, return all-nolan can be actor +director

async function resolveEntity(entityName) {
    const session=driver.session({defaultAccessMode:'READ'})
    const matches=[];//to store all matched nodes
    try{
        // exact match
        for(const {label,property} of NODE_TYPES){
            const exactResult=await session.run(
                `MATCH (n:${label})
                WHERE toLower(n.${property}) = toLower($name)
                RETURN n.${property} AS nodeName, labels(n)[0] AS label
                LIMIT 5`,
                { name: entityName }
            );

            if(exactResult.records.length>0){
                for(const record of exactResult.records){
                    matches.push({
                        searchTerm: entityName,
                        label: record.get("label"),
                        nodeName: record.get("nodeName"),
                        matchType: "exact",
                    })
                }
                continue;//got exact match hence skip other methods
            }
            // no exact matches->try contains
            const partialResult = await session.run(
                `MATCH (n:${label})
                WHERE toLower(n.${property}) CONTAINS toLower($name)
                RETURN n.${property} AS nodeName, labels(n)[0] AS label
                LIMIT 5`,
                { name: entityName }
            );

            for (const record of partialResult.records) {
                matches.push({
                searchTerm: entityName,
                label: record.get("label"),
                nodeName: record.get("nodeName"),
                matchType: "partial",
                });
            }
        }//exact match closes
        // try prefix search eg-christ -> get christopher nolan, chris evans
        // skip for for genre and label as  "scary" != "Scarlett Johansson"
           if (matches.length === 0) {
      for (const { label, property } of NODE_TYPES) {
        // Only try fuzzy matching on Genre and Theme nodes — these are the
        // short categorical values where users commonly use synonyms/typos.
        // Matching against Actor/Director names causes false positives.
        if (label !== "Genre" && label !== "Theme") continue;

        const fuzzyResult = await session.run(
          `MATCH (n:${label})
            WHERE toLower(n.${property})  STARTS WITH toLower(left($name, 
            CASE WHEN size($name) >= 4 THEN 4 ELSE size($name) END
            ))
              OR toLower($name) STARTS WITH toLower(n.${property})
            RETURN n.${property} AS nodeName, labels(n)[0] AS label
            LIMIT 5`,
           { name: entityName }
        );

        for (const record of fuzzyResult.records) {
          matches.push({
            searchTerm: entityName,
            label: record.get("label"),
            nodeName: record.get("nodeName"),
            matchType: "fuzzy",
          });
        }
      }
    }
  }
    finally{

        await session.close();
    }
    // prefer exact matches over contains and prefix
    const exactMatches=matches.filter((m)=>m.matchType==='exact');
    if(exactMatches.length>0) return exactMatches;

    return matches;
}


// now main fn ->extract all entities from query-> find them up in neo4j
/* {
    query:"action movies with tom"
    entities:"action","tom",
    unresolved:[]
}
*/ 
async function resolveQueryEntities(query){
    // extract entity from query
    const entityNames=await extractEntities(query);
    
    if(entityNames.length===0){
        return {query,entities:[],unresolved:[]};
    }
    // find the entities in graph db
    const resolved=[],unresolved=[];

    for(const name of entityNames){
        const matches=await resolveEntity(name)
        if(matches.length>0){
            for(const match of matches){
                resolved.push(match);
            }
        }
        else{
            // try llm based spelling correction
            const corrected=await correctSpelling(name);
            if(corrected){
                const correctedMatches=await resolveEntity(corrected);
                // find correct spelling in db
                if(correctedMatches.length>0){
                    for(const match of correctedMatches){
                        resolved.push({...match,searchTerm:name});
                    }
                }
                else{
                    // can't find it in db
                    unresolved.push(name);
                }
            }else{//no result from llm
                unresolved.push(name);
            }
        }
        
    }//loop closes
    return {query,entities:resolved,unresolved};

}


export {resolveQueryEntities,resolveEntity};

