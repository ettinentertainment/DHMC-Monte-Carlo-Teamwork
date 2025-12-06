const fs = require('fs');
const path = require('path');
const { validateAndCoerce } = require('./data-validation.js');

// Configuration
const JOBS = [
    {
        type: 'PLAYER',
        tempFile: 'temp_data/new_players.json',
        targetFile: 'data/premade_characters.json',
        rootKey: 'players',
        idPrefix: 'player-imported'
    },
    {
        type: 'ADVERSARY',
        tempFile: 'temp_data/new_adversaries.json',
        targetFile: 'data/srd_adversaries.json',
        rootKey: null, // Adversary file is a top-level array
        idPrefix: 'adv-imported'
    },
    {   type: 'ENVIRONMENT',
        tempFile: 'temp_data/new_environments.json',
        targetFile: 'data/environments.json',
        rootKey: null,
        idPrefix: 'env-imported'
    }
];

console.log("=== STARTING BULK DATA INGESTION ===");

JOBS.forEach(job => {
    const tempPath = path.join(__dirname, job.tempFile);
    const targetPath = path.join(__dirname, job.targetFile);
    
    // 1. Read Temp Data
    if (!fs.existsSync(tempPath)) {
        console.log(`Skipping ${job.type}: Temp file not found (${job.tempFile})`);
        return;
    }
    
    let rawNewData;
    try {
        const fileContent = fs.readFileSync(tempPath, 'utf8');
        if (!fileContent.trim()) {
            console.log(`Skipping ${job.type}: Temp file is empty.`);
            return;
        }
        rawNewData = JSON.parse(fileContent);
    } catch (e) {
        console.error(`ERROR reading ${job.tempFile}: ${e.message}`);
        return;
    }
    
    if (!Array.isArray(rawNewData)) {
        console.error(`ERROR: ${job.tempFile} must contain a JSON Array [...]`);
        return;
    }
    
    if (rawNewData.length === 0) {
        console.log(`Skipping ${job.type}: No new data to ingest.`);
        return;
    }
    
    // 2. Process & Validate
    console.log(`Processing ${rawNewData.length} new ${job.type} records...`);
    const cleanRecords = [];
    
    rawNewData.forEach((item, index) => {
        try {
            const cleanItem = validateAndCoerce(item, job.type);
            // Generate ID
            cleanItem.simId = `${job.idPrefix}-${Date.now()}-${index}`;
            cleanRecords.push(cleanItem);
            console.log(`  [OK] Prepared: ${cleanItem.name}`);
            } catch (err) {
                console.error(`  [FAIL] Skipped invalid item: ${err.message}`);
            }
        });
        
        if (cleanRecords.length === 0) return;
        
    // 3. Merge into Target
    try {
        const targetContent = fs.readFileSync(targetPath, 'utf8');
        let targetData = JSON.parse(targetContent);
        
        // Handle structure differences (Players are in {players: []}, Adversaries are [])
        let destArray;
        if (job.rootKey) {
            destArray = targetData[job.rootKey];
        } else {
            destArray = targetData;
        }
        
        destArray.push(...cleanRecords);
        
    // 4. Save Target
    fs.writeFileSync(targetPath, JSON.stringify(targetData, null, 2), 'utf8');
    console.log(`SUCCESS: Wrote ${cleanRecords.length} new records to ${job.targetFile}`);
    // 5. Clear Temp File (Optional - set to [] to prevent double add)
    fs.writeFileSync(tempPath, '[]', 'utf8');
    console.log(`CLEANUP: Cleared ${job.tempFile}`);
    
    } catch (e) {
        console.error(`CRITICAL ERROR writing to ${job.targetFile}: ${e.message}`);
    }
});