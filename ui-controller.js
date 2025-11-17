// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // Column 1 Buttons
    document.getElementById('add-character-button').addEventListener('click', addCharacterToPool);
    document.getElementById('add-adversary-button').addEventListener('click', addAdversaryToPool);
    document.getElementById('add-environment-button').addEventListener('click', addEnvironmentToPool); // NEW

    // Main Run Buttons
    document.getElementById('run-button').addEventListener('click', () => runMultipleSimulations(1));
    document.getElementById('run-multiple-button').addEventListener('click', () => runMultipleSimulations(5));
    document.getElementById('run-ten-button').addEventListener('click', () => runMultipleSimulations(10));
    document.getElementById('export-log-button').addEventListener('click', exportLog);
    
    // Playback Button Listener
    const playbackButton = document.getElementById('playback-button');
    if (playbackButton) {
        playbackButton.addEventListener('click', () => {
            if (simHistory.length > 0) {
                playBackSimulation(simHistory.length - 1);
            }
        });
    } else {
        console.error("CRITICAL: Playback button not found in index.html");
    }

    // Modal Listeners
    const modal = document.getElementById('manual-add-modal');
    const modalBtn = document.getElementById('add-to-pool-button');
    const modalCloseBtn = document.getElementById('modal-close-button');
    
    modalBtn.onclick = function() {
        modal.style.display = "flex";
    }
    modalCloseBtn.onclick = function() {
        modal.style.display = "none";
    }
    // Close if user clicks overlay
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }

    // Info Modal Listeners
    const infoModal = document.getElementById('info-modal-overlay');
    const infoModalCloseBtn = document.getElementById('info-modal-close-button');
    
    infoModalCloseBtn.onclick = function() {
        infoModal.style.display = "none";
        }
        // Also close if user clicks overlay
        window.addEventListener('click', (event) => {
            if (event.target == infoModal) {
                infoModal.style.display = "none";
            }
        });


    // Column 1, 2 & 3 Click Handlers
    document.getElementById('column-1').addEventListener('click', handlePoolClick);
    document.getElementById('column-2').addEventListener('click', handlePoolClick);
    document.getElementById('column-3').addEventListener('click', handleSceneClick);
    
    // Pool Filter Listeners
    document.getElementById('pc-pool-class-filter').addEventListener('change', renderPools);
    document.getElementById('pc-pool-level-filter').addEventListener('change', renderPools);
    document.getElementById('adv-pool-tier-filter').addEventListener('change', renderPools);
    document.getElementById('adv-pool-type-filter').addEventListener('change', renderPools);
    document.getElementById('adv-pool-bp-filter').addEventListener('change', renderPools);
    

    // Hide old visualize checkbox
    const visualizeToggle = document.getElementById('visualize-checkbox');
    if(visualizeToggle) visualizeToggle.style.display = 'none';
    
    // Load all data
    loadAndPopulateDatabases();
    renderSurvivorPool(); //NEW
    renderBpModifierPool();
    renderActiveBpModifiers();
    
    // Initial Renders
    renderActiveScene();
    renderActiveEnvironment(); // NEW
    initializeBattlemap();
});

// --- SPOTLIGHT SIMULATION ENGINE ---
async function runMultipleSimulations(count) {

    //Log start of multi-simulation to F12 console
    console.log("DEBUG: runMultipleSimulations triggered with count:", count);
    
    printToLog(`\n===== STARTING BATCH OF ${count} SIMULATION(S) =====`);
    
    simHistory = [];
    const playbackBtn = document.getElementById('playback-button');
    if (playbackBtn) {
        playbackBtn.disabled = true;
    }

    const mapSize = document.getElementById('map-size-select').value;

    for (let i = 1; i <= count; i++) {
        // Run the simulation synchronously.
        runSimulation(count, mapSize); 
        
        // "Breathe" to prevent freezing after a very fast synchronous run
        if (count > 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    printToLog(`\n===== BATCH COMPLETE =====`);
    
    renderSurvivorPool(); // NEW: Refresh survivor pool UI
    renderBpModifierPool(); // NEW
    renderActiveBpModifiers(); // NEW

    if (count === 1 && simHistory.length === 1 && simHistory[0].playbackLog) {
        if (playbackBtn) {
            playbackBtn.disabled = false;
        }
    }
}

// --- DATA & POOL MANAGEMENT ---

async function loadAndPopulateDatabases() {
    await loadPCDatabase();
    await loadSRDDatabase();
    await loadEnvironmentDatabase(); // NEW
    
    // After all are loaded, render pools
    renderPools();
    renderEnvironmentPool(); // NEW
}

async function loadSRDDatabase() {
    try {
        const response = await fetch('data/srd_adversaries.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json(); 
        if (Array.isArray(data)) {
            SRD_ADVERSARIES = data;
            adversaryPool = SRD_ADVERSARIES.map((adv, index) => ({
                ...adv,
                simId: `adv-master-${Date.now()}-${index}`
            }));
        } else {
            throw new Error("Invalid JSON structure. Expected a top-level array '[...]'");
        }
        printToLog(`Successfully loaded and populated ${adversaryPool.length} adversaries.`);
    } catch (error) {
        printToLog(`--- FATAL ERROR --- Could not load SRD Adversary JSON: ${error.message}`);
        console.error("Failed to fetch SRD data:", error);
    }
}

async function loadPCDatabase() {
    try {
        const response = await fetch('data/premade_characters.json'); 
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json(); 
        if (data && Array.isArray(data.players)) {
            PREMADE_CHARACTERS = data.players;
            playerPool = PREMADE_CHARACTERS.map((pc, index) => ({
                ...pc,
                simId: `player-${Date.now()}-${index}`
            }));
        } else {
            throw new Error("Invalid JSON structure. Expected an object with a 'players' array.");
        }
        printToLog(`Successfully loaded and populated ${playerPool.length} PCs.`);
    } catch (error) {
        printToLog(`--- FATAL ERROR --- Could not load Premade PC JSON: ${error.message}`);
        console.error("Failed to fetch PC data:", error);
    }
}

// NEW: Load Environments
async function loadEnvironmentDatabase() {
    // TODO: Load from environments.json when it exists
    // For now, create placeholders
    PLACEHOLDER_ENVIRONMENTS = [
        { name: "Placeholder: Tier 1", difficulty: 11, tier: 1, simId: `env-${Date.now()}-1` },
        { name: "Placeholder: Tier 2", difficulty: 14, tier: 2, simId: `env-${Date.now()}-2` },
        { name: "Placeholder: Tier 3", difficulty: 17, tier: 3, simId: `env-${Date.now()}-3` },
        { name: "Placeholder: Tier 4", difficulty: 20, tier: 4, simId: `env-${Date.now()}-4` }
    ];
    environmentPool = [...PLACEHOLDER_ENVIRONMENTS];
    printToLog(`Successfully loaded ${environmentPool.length} placeholder environments.`);
}

// NEW: Helper function to calculate BP cost
function getAdversaryBpCost(adv) {
    if (!adv.type) return 0;
    switch (adv.type) {
        case 'Solo':
            return 5;
        case 'Bruiser':
            return 4;
        case 'Leader':
            return 3;
        case 'Horde':
        case 'Ranged':
        case 'Skulk':
        case 'Standard':
             return 2;
        case 'Minion':
        case 'Social':
        case 'Support':
            return 1;
        default:
            return 0;
    }
}  


// NEW: Helper function to calculate complexity
function getAdversaryComplexity(adv) {
    if (!adv.features) return 0;
    const featureCount = adv.features.length;
    if (featureCount <= 2) return 1;
    if (featureCount <= 4) return 2;
    return 3;
}

// NEW: Helper to render complexity stars
function renderComplexityStars(complexity) {
    let stars = '';
    for (let i = 1; i <= 3; i++) {
        if (i <= complexity) {
            stars += `<span class="star filled">★</span>`;
        } else {
            stars += `<span class="star">☆</span>`;
        }
    }
    return `<span class="complexity-stars">${stars}</span>`;
}


function addCharacterToPool() {
    const jsonTextBox = document.getElementById('character-json');
    try {
        const newCharacter = JSON.parse(jsonTextBox.value);
        if (!newCharacter.name || !newCharacter.traits) throw new Error('JSON missing "name" or "traits"');
        
        newCharacter.simId = `player-manual-${Date.now()}`;
        playerPool.push(newCharacter); 
        printToLog(`Added ${newCharacter.name} to Player Pool.`);
        jsonTextBox.value = '';
        renderPools(); 
    } catch (e) { printToLog(`--- ERROR --- \nInvalid Character JSON. ${e.message}`); }
}

function addAdversaryToPool() {
    const jsonTextBox = document.getElementById('adversary-json');
    try {
        const newAdversary = JSON.parse(jsonTextBox.value);
        if (!newAdversary.name || !newAdversary.difficulty) throw new Error('JSON missing "name" or "difficulty"');

        newAdversary.simId = `adv-manual-${Date.now()}`;
        adversaryPool.push(newAdversary); 
        printToLog(`Added ${newAdversary.name} to Adversary Pool.`);
        jsonTextBox.value = '';
        renderPools();
    } catch (e) { printToLog(`--- ERROR --- \nInvalid Adversary JSON. ${e.message}`); }
}

// NEW: Add Environment
function addEnvironmentToPool() {
    const jsonTextBox = document.getElementById('environment-json');
    try {
        const newEnv = JSON.parse(jsonTextBox.value);
        if (!newEnv.name || !newEnv.difficulty) throw new Error('JSON missing "name" or "difficulty"');

        newEnv.simId = `env-manual-${Date.now()}`;
        environmentPool.push(newEnv); 
        printToLog(`Added ${newEnv.name} to Environment Pool.`);
        jsonTextBox.value = '';
        renderEnvironmentPool();
    } catch (e) { printToLog(`--- ERROR --- \nInvalid Environment JSON. ${e.message}`); }
}


// --- DYNAMIC CLICK HANDLERS ---
function handlePoolClick(event) {
    const target = event.target;
    
    // Find the closest parent .pool-item to get the ID
    const agentItem = target.closest('.pool-item');
    if (!agentItem) return; // Click was not on an item

    const agentId = agentItem.dataset.id;
    if (!agentId) return; // Item has no ID
    
    // --- NEW: Check if the click was on the move button or the name ---
    const moveButton = target.closest('button.move-button');
    const agentName = target.closest('.agent-name');
    
    if (moveButton) {
        // --- This is the existing logic for moving items ---
        
        // Player Pool
        let player = playerPool.find(p => p.simId === agentId);
        if (player) {
            const newPlayerInstance = JSON.parse(JSON.stringify(player));
            newPlayerInstance.simId = `player-instance-${Date.now()}-${Math.random()}`;
            activeParty.push(newPlayerInstance);
            printToLog(`Copied ${newPlayerInstance.name} to Active Scene.`);
            renderActiveScene();
            return;
        }
        
        // Adversary Pool
        let agentTemplate = adversaryPool.find(a => a.simId === agentId);
        if (agentTemplate) {
            const newAgentInstance = JSON.parse(JSON.stringify(agentTemplate));
            newAgentInstance.simId = `adv-instance-${Date.now()}-${Math.random()}`;
            activeAdversaries.push(newAgentInstance);
            printToLog(`Copied ${newAgentInstance.name} to Active Scene.`);
            renderActiveScene();
            return;
        }
        
        // Survivor Pool
        let survivorIndex = survivorPool.findIndex(s => s.simId === agentId);
        if(survivorIndex > -1) {
            // Move the survivor from the pool to the active party
            const survivorInstance = survivorPool.splice(survivorIndex, 1)[0];
            activeParty.push(survivorInstance);
            printToLog(`Moved survivor ${survivorInstance.name} to Active Scene.`);
            renderSurvivorPool();
            renderActiveScene();
            return;
        }
        
        // Environment Pool
        let envTemplate = environmentPool.find(e => e.simId === agentId);
        if (envTemplate) {
            activeEnvironment = JSON.parse(JSON.stringify(envTemplate)); // Set as active (singular)
            activeEnvironment.simId = `env-instance-${Date.now()}-${Math.random()}`;
            printToLog(`Set Active Environment to: ${activeEnvironment.name}.`);
            renderActiveEnvironment();
            return;
        }

        // BP Modifier Pool
        let modIndex = BP_MODIFIER_LIBRARY.findIndex(m => m.id === agentId);
        if (modIndex > -1) {
            // Check if it's already active
            if (!activeBpModifiers.some(m => m.id === agentId)) {
                activeBpModifiers.push(BP_MODIFIER_LIBRARY[modIndex]);
                printToLog(`Added BP Modifier: ${BP_MODIFIER_LIBRARY[modIndex].name}`);
                renderActiveBpModifiers();
                renderActiveScene();
            }
            return;
        }
        
    } else if (agentName) {
        // --- NEW: This is the logic for showing the info modal ---
        showInfoModal(agentId);
        return;
    }
}

function handleSceneClick(event) {
    const target = event.target;
    if (!target.classList.contains('move-button')) return; 
    const agentItem = target.closest('.scene-item');
    if (!agentItem) return;
    
    const agentId = agentItem.dataset.id;
    if (!agentId) return;

    // Check Party
    let playerIndex = activeParty.findIndex(p => p.simId === agentId);
    if (playerIndex > -1) {
        const agent = activeParty.splice(playerIndex, 1)[0];
        printToLog(`Removed ${agent.name} instance from Active Scene.`);
        renderActiveScene();
        return;
    }

    // Check Adversaries
    let adversaryIndex = activeAdversaries.findIndex(a => a.simId === agentId);
    if (adversaryIndex > -1) {
        const agent = activeAdversaries.splice(adversaryIndex, 1)[0];
        printToLog(`Removed ${agent.name} instance from Active Scene.`);
        renderActiveScene();
        return;
    }

    // Check Environment
    if (activeEnvironment && activeEnvironment.simId === agentId) {
        printToLog(`Removed ${activeEnvironment.name} from Active Scene.`);
        activeEnvironment = null;
        renderActiveEnvironment();
        return;
    }

    // Check Active BP Modifiers
    let modIndex = activeBpModifiers.findIndex(m => m.id === agentId);
    if (modIndex > -1) {
        const mod = activeBpModifiers.splice(modIndex, 1)[0];
        printToLog(`Removed BP Modifier: ${mod.name}`);
        renderActiveBpModifiers();
        renderActiveScene();
        return;
    }
}

// --- DYNAMIC UI RENDERING ---

function renderPools() {
    const playerListDiv = document.getElementById('player-pool-list');
    const adversaryListDiv = document.getElementById('adversary-pool-list');
    playerListDiv.innerHTML = '';
    adversaryListDiv.innerHTML = '';

    // 1. Get Filter Values
    const pcClassFilter = document.getElementById('pc-pool-class-filter').value;
    const pcLevelFilter = document.getElementById('pc-pool-level-filter').value;
    const advTierFilter = document.getElementById('adv-pool-tier-filter').value;
    const advTypeFilter = document.getElementById('adv-pool-type-filter').value;
    const advBpFilter = document.getElementById('adv-pool-bp-filter').value;

    // 2. Filter Player Pool
    const filteredPlayers = playerPool.filter(char => {
        const isManual = !char.class || !char.level;
        if (isManual) {
            return (pcClassFilter === 'all' && pcLevelFilter === 'all'); // Only show manual adds if no filter
        }
        const classMatch = (pcClassFilter === 'all' || char.class.name === pcClassFilter);
        const levelMatch = (pcLevelFilter === 'all' || char.level == pcLevelFilter);
        return classMatch && levelMatch;
    });

    // 3. Filter Adversary Pool
    const filteredAdversaries = adversaryPool.filter(adv => {
        const isManual = !adv.tier || !adv.type;
        const bpCost = getAdversaryBpCost(adv);
        
        if (isManual) {
            return (advTierFilter === 'all' && advTypeFilter === 'all' && advBpFilter === 'all'); // Only show manual adds if no filter
        }
        const tierMatch = (advTierFilter === 'all' || adv.tier == advTierFilter);
        const typeMatch = (advTypeFilter === 'all' || adv.type === advTypeFilter);
        const bpMatch = (advBpFilter === 'all' || bpCost == advBpFilter);
        
        return tierMatch && typeMatch && bpMatch;
    });

    // 4. Render Filtered Players
    filteredPlayers.forEach(char => {
        const level = char.level || 'Custom';
        const className = char.class?.name || 'JSON';
        playerListDiv.innerHTML += `
        <div class="pool-item" data-id="${char.simId}">
            <span class="agent-name">${char.name} (Lvl ${level} ${className})</span>
            <div class="pool-item-controls">
                <button class="move-button" title="Add to Active Scene">&gt;</button>
            </div>
        </div>
        `;
    });

    // 5. Render Filtered Adversaries
    filteredAdversaries.forEach(adv => {
        const bpCost = getAdversaryBpCost(adv);
        const difficulty = adv.difficulty || 'N/A';
        const complexity = getAdversaryComplexity(adv);
        const complexityStars = renderComplexityStars(complexity); // Get stars
        let features = "No features listed.";
        if (adv.features && adv.features.length > 0) {
             features = adv.features.map(f => `• ${f.name} (${f.type})`).join('\n');
        }

        adversaryListDiv.innerHTML += `
        <div class="pool-item" data-id="${adv.simId}" title="${features}">
            <span class="agent-name">${adv.name} (Diff ${difficulty} | BP: ${bpCost}) ${complexityStars}</span>
                <div class=\"pool-item-controls\">
                    <button class="move-button" title="Add to Active Scene">&gt;</button>
                </div>
            </div>
        `;
    });

    if (filteredPlayers.length === 0 && playerPool.length > 0) {
        playerListDiv.innerHTML = `<div class="pool-item"><span>No players match filters.</span></div>`;
    }
    if (filteredAdversaries.length === 0 && adversaryPool.length > 0) {
        adversaryListDiv.innerHTML = `<div class="pool-item"><span>No adversaries match filters.</span></div>`;
    }
}



// New: Render Survivor Pool
function renderSurvivorPool() {
    const survivorListDiv = document.getElementById('survivor-pool-list');
    survivorListDiv.innerHTML = '';

    if(survivorPool.length === 0) {
        survivorListDiv.innerHTML = `<div class="pool-item"><span>No survivors yet.</span></div>`;
        return;
    }
    survivorPool.forEach(char => {
        // Display current state, not max state
        const status = `HP: ${char.current_hp}/${char.max_hp} | Stress: ${char.current_stress}/${char.max_stress}`;
        survivorListDiv.innerHTML += `
        <div class="pool-item" data-id="${char.simId}" title="${status}">
            <span class="agent-name">${char.name} (Lvl ${char.level} ${char.class})<span>
            <div class="pool-item-controls">
                <button class="move-button" title="Add to Active Scene">&gt;</button>
            </div>
        </div>
        `;
    });

}



// NEW: Render Environment Pool
function renderEnvironmentPool() {
    const envListDiv = document.getElementById('environment-pool-list');
    envListDiv.innerHTML = '';

    environmentPool.forEach(env => {
        envListDiv.innerHTML += `
        <div class="pool-item" data-id="${env.simId}">
            <span class="agent-name">${env.name} (Diff ${env.difficulty})</span>
            <div class="pool-item-controls">
                <button class="move-button" title="Set as Active Environment">&gt;</button>
            </div>
        </div>
        `;
    });
}

function renderActiveScene() {
    const partyListDiv = document.getElementById('active-party-list');
    const adversaryListDiv = document.getElementById('active-adversary-list');
    partyListDiv.innerHTML = '';
    adversaryListDiv.innerHTML = '';
    activeAdversaries.forEach(adv => {
        adversaryListDiv.innerHTML += `
        <div class="scene-item" data-id="${adv.simId}">
            <button class="move-button" title="Remove from Scene">&lt;</button>
                <span class="agent-name">${adv.name} (Diff ${adv.difficulty})</span>
            </div>
        `;
    });

    // --- Calculate BP Budget ---
    const numPCs = activeParty.length;

        // Sum manual BP modifiers from the active pool
    const manualModifierBP = activeBpModifiers.reduce((acc, mod) => acc + mod.bpValue, 0);

    const totalBattlepointBudget = (numPCs > 0 ? (3 * numPCs) + 2 : 0) + manualModifierBP;

    activeParty.forEach(char => {
        partyListDiv.innerHTML += `
        <div class="scene-item" data-id="${char.simId}">
            <button class="move-button" title="Remove from Scene">&lt;</button>
            <span class="agent-name">${char.name} (Lvl ${char.level})</span>
        </div>
        `;
    });

    

    // --- NEW: Read modifier and calculate total spent BP ---
    // Sum BP from adversaries
    let adversaryBP = 0;
    activeAdversaries.forEach(adv => {
        switch (adv.type) {
            case 'Solo': adversaryBP += 5; break;
            case 'Bruiser': adversaryBP += 4; break;
            case 'Leader': adversaryBP += 3; break;
            case 'Horde': case 'Ranged': case 'Skulk': case 'Standard': adversaryBP += 2; break;
            case 'Minion': case 'Social': case 'Support': adversaryBP += 1; break;
            default: adversaryBP += 0;
        }
    });
    

    
    // TODO: Add reactive BP modifiers (e.g., 2+ Solos)
    const reactiveBP = 0;
    
    const totalSpentBP = adversaryBP + reactiveBP;
    // --- End New Logic ---

    updateBattlepointDisplay(totalSpentBP, totalBattlepointBudget); // Call with both values
}

// NEW: Update Battlepoint Display
function updateBattlepointDisplay(spentPoints, budgetPoints) {
    const display = document.getElementById('battlepoint-display');
    if (display) {
        display.innerText = `(Spent: ${spentPoints} / Budget: ${budgetPoints})`;
        
        // Remove old classes
        display.classList.remove('bp-display-under', 'bp-display-good', 'bp-display-over');
        
        // Add new class based on budget
        if (budgetPoints === 0) {
            display.classList.add('bp-display-under');
        } else if (spentPoints > budgetPoints) {
            display.classList.add('bp-display-over'); // Red
        } else if (spentPoints >= budgetPoints * 0.9) {
            display.classList.add('bp-display-under'); // Yellow
        } else {
            display.classList.add('bp-display-good'); // Green (90-100%)
        }
    }
}

// NEW: Render Active Environment
function renderActiveEnvironment() {
    const activeEnvDiv = document.getElementById('active-environment');
    activeEnvDiv.innerHTML = '';

    if (activeEnvironment) {
        activeEnvDiv.innerHTML += `
        <div class="scene-item" data-id="${activeEnvironment.simId}">
            <button class="move-button" title="Remove from Scene">&lt;</button>
            <span class="agent-name">${activeEnvironment.name} (Diff ${activeEnvironment.difficulty})</span>
        </div>
        `;
    }
}

// --- *** NEW LOGGING SYSTEM *** ---
// printToLog(message, className) prints text to the *actual* UI
function printToLog(message, className = null) {
    const logOutput = document.getElementById('log-output');
    if (logOutput) {
        const el = document.createElement('div');
        if (className) {
            el.className = className;
        }
        el.innerText = message; // Use innerText to preserve line breaks from scoreboard
        logOutput.appendChild(el);
        logOutput.scrollTop = logOutput.scrollHeight; 
    }
}
// --- *** END NEW LOGGING SYSTEM *** ---
 
// --- VISUALIZER RENDER FUNCTION ---
function initializeBattlemap(gameState) {
    const map = document.getElementById('battlemap-grid');
    if (!map) return;
    map.innerHTML = '';
    tokenCache = {};

    const mapSize = document.getElementById('map-size-select').value;
    CURRENT_BATTLEFIELD = {
        ...DAGGERHEART_RANGES,
        ...MAP_CONFIGS[mapSize] 
    };

    map.style.gridTemplateColumns = `repeat(${CURRENT_BATTLEFIELD.MAX_X}, 1fr)`;
    map.style.gridTemplateRows = `repeat(${CURRENT_BATTLEFIELD.MAX_Y}, 1fr)`;
    
    let gridHtml = '';
    const totalCells = CURRENT_BATTLEFIELD.MAX_X * CURRENT_BATTLEFIELD.MAX_Y;
    for (let i = 0; i < totalCells; i++) {
        gridHtml += '<div class="empty-cell"></div>';
    }
    map.innerHTML = gridHtml;

    if (gameState) {
        initializeTokens(gameState);
    }
}

function initializeTokens(gameState) {
    const map = document.getElementById('battlemap-grid');
    if (!map) return;

    for (const tokenId in tokenCache) {
        tokenCache[tokenId].remove();
    }
    tokenCache = {};

    for (const player of gameState.players) {
        const token = document.createElement('div');
        token.className = 'token player-token';
        token.id = player.id;
        map.appendChild(token);
        tokenCache[player.id] = token;
    }

    for (const adv of gameState.adversaries) {
        const token = document.createElement('div');
        token.className = 'token adversary-token';
        token.id = adv.id;
        map.appendChild(token);
        tokenCache[adv.id] = token;
    }
    
    renderBattlemap(gameState);
}

function renderBattlemap(gameState) {
    for (const player of gameState.players) {
        const token = tokenCache[player.id];
        if (!token) continue;

        if (player.current_hp <= 0) {
            token.style.display = 'none';
        } else {
            token.style.display = 'block';
            token.title = `${player.name} (HP: ${player.current_hp})`;
            token.style.gridColumn = player.position.x;
            token.style.gridRow = player.position.y;
        }
    }

    for (const adv of gameState.adversaries) {
        const token = tokenCache[adv.id];
        if (!token) continue;
        
        if (adv.current_hp <= 0) {
            token.style.display = 'none';
        } else {
            token.style.display = 'block';
            token.title = `${adv.name} (HP: ${adv.current_hp})`;
            token.style.gridColumn = adv.position.x;
            token.style.gridRow = adv.position.y;
        }
    }
}

function exportLog() {
    const logOutput = document.getElementById('log-output');
    const logContent = logOutput.innerText; // Use innerText to get formatted text
    
    const blob = new Blob([logContent], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dhmc_simulation_log_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    printToLog(`\n--- Log exported! ---`);
}

async function playBackSimulation(historyIndex) {
    const simData = simHistory[historyIndex];
    if (!simData || !simData.playbackLog) {
        alert("No visual playback data found for this simulation.");
        return;
    }
    
    const mapContainer = document.getElementById('visualizer-container');
    const logContainer = document.getElementById('log-container');
    
    mapContainer.classList.remove('hidden');
    logContainer.classList.remove('full-width');
    
    printToLog(`\n\n=== STARTING REPLAY OF SIMULATION #${simData.id} ===`);

    const map = document.getElementById('battlemap-grid');
    map.innerHTML = '';
    tokenCache = {}; 
    
    const initialState = simData.playbackLog[0];

    map.style.gridTemplateColumns = `repeat(${CURRENT_BATTLEFIELD.MAX_X}, 1fr)`;
    map.style.gridTemplateRows = `repeat(${CURRENT_BATTLEFIELD.MAX_Y}, 1fr)`;

    let gridHtml = '';
    const totalCells = CURRENT_BATTLEFIELD.MAX_X * CURRENT_BATTLEFIELD.MAX_Y;
    for (let i = 0; i < totalCells; i++) {
        gridHtml += '<div class="empty-cell"></div>';
    }
    map.innerHTML = gridHtml;

    const allAgents = [...initialState.players, ...initialState.adversaries];
    for (const agent of allAgents) {
        const token = document.createElement('div');
        token.className = agent.id.startsWith('player') ? 'token player-token' : 'token adversary-token';
        token.id = agent.id;
        map.appendChild(token);
        tokenCache[agent.id] = token;
    }
    
    for (let i = 0; i < simData.playbackLog.length; i++) {
        const snapshot = simData.playbackLog[i];
        
        for (const agent of [...snapshot.players, ...snapshot.adversaries]) {
            const token = tokenCache[agent.id];
            if (!token) continue;
            
            if (agent.current_hp <= 0) {
                token.style.display = 'none';
            } else {
                token.style.display = 'block';
                token.title = `${agent.name} (HP: ${agent.current_hp})`;
                token.style.gridColumn = agent.position.x;
                token.style.gridRow = agent.position.y;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    printToLog(`=== REPLAY COMPLETE. Duration: ${simData.duration.toFixed(2)}s ===`);
}

// --- NEW: INFO MODAL LOGIC ---
// 
/**
 *  * Finds an agent object from any of the global pools by its simId.
 *  * @param {string} agentId - The simId of the agent to find.
 *  * @returns {object|null} The agent object or null if not found.
 *  */
function getAgentFromPools(agentId) {
    return playerPool.find(p => p.simId === agentId) || 
    adversaryPool.find(a => a.simId === agentId) || 
    survivorPool.find(s => s.simId === agentId) || 
    environmentPool.find(e => e.simId === agentId) || 
    null;
}

/**
 *  * Finds an agent by ID, formats its JSON, and displays it in the info modal.
 *  * @param {string} agentId - The simId of the agent to display.
 *  */
function showInfoModal(agentId) {
    const agent = getAgentFromPools(agentId);
    if (!agent) {
        console.error(`Could not find agent with ID: ${agentId}`);
        return;
        
    }
    
    // Format the JSON object for readable display
    const formattedJson = JSON.stringify(agent, null, 2);
    
    // Get modal elements and display data
    const infoModal = document.getElementById('info-modal-overlay');
    const infoModalContent = document.getElementById('info-modal-content');
    
    infoModalContent.textContent = formattedJson;
    infoModal.style.display = "flex";
}

function renderBpModifierPool() {
    const poolListDiv = document.getElementById('bpAdjustment-pool-list');
    poolListDiv.innerHTML = '';
    
    BP_MODIFIER_LIBRARY.forEach(mod => {
        const title = `Value: ${mod.bpValue} BP`;
        poolListDiv.innerHTML += `
        <div class="pool-item" data-id="${mod.id}" title="${title}">
        <span class="agent-name">${mod.name}</span>
        <div class="pool-item-controls">
        <button class="move-button" title="Add to Active Scene">&gt;</button>
        </div>
        </div>
        `;
    });
}

function renderActiveBpModifiers() {
    const activeListDiv = document.getElementById('active-bp-adjustments-list');
    activeListDiv.innerHTML = '';
    
    if (activeBpModifiers.length === 0) {
        activeListDiv.innerHTML = `<div class="scene-item"><span>No active adjustments.</span></div>`;
        return;
    }
    
    activeBpModifiers.forEach(mod => {
        activeListDiv.innerHTML += `
        <div class="scene-item" data-id="${mod.id}">
        <button class="move-button" title="Remove from Scene">&lt;</button>
        <span class="agent-name">${mod.name} (${mod.bpValue} BP)</span>
        </div>
        `;
    });
}
