// graph builder :json->neo4j

// each entity- node , each connection-relationship
// merge vs create:
// create always makes a new node(causes duplicates)
// merge first check "does it exist",then create only if not exist

// indexes: without index -merge scans all nodes to find match (slow), with index-merge uses lookup table (fast)

import {driver} from "./config.js"

// insert one movie entity and relationship
async function insertMovieGraph(entity){
    // here entity is one movie,see this fn with entity pov
    const session=driver.session();
    try{
        await session.executeWrite(async(tx)=>{
      // Movie node   
            await tx.run(
                `MERGE (m:MOVIE {title:$title})
                SET m.year=$year,

                {title:entity.movie.title,year:entity.movie.year}`)

 // Director node + DIRECTED relationship
            await tx.run(
                `MERGE (d:Director {name:$name})
                MERGE (m:Movie {title:$title})
                MERGE (d)-[:DIRECTED]->(m),

                {name:entity.director.name,title:entity:movie.title}`)
// Actor nodes + ACTED_IN relationships
            for(const actorName of entity.actors){
                await tx.run(
                `MERGE (a:Actor {name: $name})
                MERGE (m:Movie {title: $title})
                MERGE (a)-[:ACTED_IN]->(m)`,

                { name: actorName, title: entity.movie.title }
            );
            }
            // genre node +BELONGS_TO relationship
            for(const genreName of entity.genres){

                 await tx.run(
                `MERGE (g:Genre {name: $name})
                MERGE (m:Movie {title: $title})
                MERGE (m)-[:BELONGS_TO]->(g)`,

                { name: genreName, title: entity.movie.title }
                );
            }
            // theme nodes +EXPLORES rn

            for(const themeName of entity.themes){
                await tx.run(
                `MERGE (t:Theme {name: $name})
                MERGE (m:Movie {title: $title})
                MERGE (m)-[:EXPLORES]->(t)`,

                { name: themeName, title: entity.movie.title }
                );

            }
            // awards node + WON rn
        for(const awardName of entity.awards){
            const match=awardName.match(/^(.+?)\s*\((.+)\)$/);
            if(match){
                 await tx.run(
                `MERGE (aw:Award {name: $awardType, category: $category})
                MERGE (m:Movie {title: $title})
                MERGE (m)-[:WON]->(aw)`,

                {
                awardType: match[1].trim(),
                category: match[2].trim(),
                title: entity.movie.title,
                }
            );
            }
        }
        });
    }
    catch(e){
        console.log(e.message);
        return;
    }
    finally{
        await session.close();
    }
}

// build complete graph for all movies
async function buildGraph(entities){
    const session=driver.session();
    // creting indexes for fast merge

    try{
         await session.run("CREATE INDEX IF NOT EXISTS FOR (m:Movie) ON (m.title)");
        await session.run("CREATE INDEX IF NOT EXISTS FOR (d:Director) ON (d.name)");
        await session.run("CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)");
        await session.run("CREATE INDEX IF NOT EXISTS FOR (g:Genre) ON (g.name)");
        await session.run("CREATE INDEX IF NOT EXISTS FOR (t:Theme) ON (t.name)");
        await session.run("CREATE INDEX IF NOT EXISTS FOR (aw:Award) ON (aw.name, aw.category)");
        console.log("Indexes created.");
    }
    finally{
        await session.close();
    }
    // insert all  movies one by one
    for(let i=0;i<entities.length;i++){
        // calling above fn
        await insertMovieGraph(entities[i]);
    }
    const statsSession=driver.session();
    try{
        // just for printing the stats data
        const nodeCount=await statsSession.run("MATCH (n) RETURN count(n) AS count");
        const relCount=await statsSession.run("MATCH ()-[r]->() RETURN count(r) AS count");
        console.log("graph build");
        console.log(`   Nodes: ${nodeCount.records[0].get("count")}`);
        console.log(`   Relationships: ${relCount.records[0].get("count")}`);

    }
    finally{
        await statsSession.close();
    }
}

export {insertMovieGraph,buildGraph};