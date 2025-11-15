// --- GLOBAL STATE ---
let playerPool = [];
let adversaryPool = [];
let environmentPool = [];
let activeParty = [];
let activeAdversaries = {}; // CHANGED: Now an object { 'encounter-1': [], 'encounter-2': [] }
let activeEnvironment = null;
let SRD_ADVERSARIES = [];
let PREMADE_CHARACTERS = [];
let PLACEHOLDER_ENVIRONMENTS = [];
let encounterCount = 1; // Start with 1 encounter

let BATCH_LOG = []; // Global log capture
let tokenCache = {}; 
let simHistory = [];

// --- BATTLEFIELD & RANGE CONFIGS ---
const DAGGERHEART_RANGES = {
    RANGE_MELEE: 1,
    RANGE_VERY_CLOSE: 3,
    RANGE_CLOSE: 6,
    RANGE_FAR: 12,
    RANGE_VERY_FAR: 24
};
const MAP_CONFIGS = {
    small: { MAX_X: 15, MAX_Y: 15  },
    medium: { MAX_X: 20, MAX_Y: 20  },
    large: { MAX_X: 30, MAX_Y: 30  }
};
let CURRENT_BATTLEFIELD = {
    ...DAGGERHEART_RANGES,
    ...MAP_CONFIGS.large 
};

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // Column 1 Buttons
    document.getElementById('add-character-button').addEventListener('click', addCharacterToPool);
    document.getElementById('add-adversary-button').addEventListener('click', addAdversaryToPool);
    document.getElementById('add-environment-button').addEventListener('click', addEnvironmentToPool);

    // Main Run Buttons (Now for Encounter 1 ONLY)
    document.getElementById('run-button').addEventListener('click', () => runMultipleSimulations(1)); // This now runs Enc 1, 1 time
    document.getElementById('run-multiple-button').addEventListener('click', () => runMultipleSimulations(5)); // This now runs Enc 1, 5 times
    
    // Playback Button
    const playbackButton = document.getElementById('playback-button');
    if (playbackButton) {
        playbackButton.addEventListener('click', () => {
            if (simHistory.length > 0) {
                playBackSimulation(simHistory.length - 1);
            }
        });
    }

    // Column 2 & 3 Click Handlers
    document.getElementById('pool-column').addEventListener('click', handlePoolClick);
    document.getElementById('scene-column').addEventListener('click', handleSceneClick);
    
    // Pool Filter Listeners
    document.getElementById('pc-pool-class-filter').addEventListener('change', renderPools);
    document.getElementById('pc-pool-level-filter').addEventListener('change', renderPools);
    document.getElementById('adv-pool-tier-filter').addEventListener('change', renderPools);
    document.getElementById('adv-pool-type-filter').addEventListener('change', renderPools);

    // Sequence Control Listeners
    document.getElementById('add-encounter-button').addEventListener('click', addNewEncounterBlock);
    document.getElementById('run-sequence-button').addEventListener('click', runFullEncounterSequence);
    
    // *** THIS IS THE FIX ***
    // The event listener that was causing the crash
    document.getElementById('export-log-button').addEventListener('click', exportLog);
    // *** END FIX ***

    // Add listener for the *first* toggle button
    document.querySelector('.toggle-button').addEventListener('click', toggleEncounterBlock);

    // Hide old visualize checkbox
    const visualizeToggle = document.getElementById('visualize-checkbox');
    if(visualizeToggle) visualizeToggle.style.display = 'none';
    
    // Load all data
    loadAndPopulateDatabases();
    
    // Initial Renders
    activeAdversaries['encounter-1'] = []; // Initialize encounter 1 list
    renderActiveScene();
    renderActiveEnvironment();
    updateBPCounter(); // NEW
    initializeBattlemap();
});

// --- DATA & POOL MANAGEMENT ---
async function loadAndPopulateDatabases() {
    await loadPCDatabase();
    await loadSRDDatabase();
    await loadEnvironmentDatabase();
    
    renderPools();
    renderEnvironmentPool();
}

async function loadSRDDatabase() {
    try {
        // --- FIX: Corrected path to 'data/' folder ---
        const response = await fetch('data/srd_adversaries.json');
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        const data = await response.json(); 
        if (Array.isArray(data)) {
            SRD_ADVERSARIES = data;
            adversaryPool = SRD_ADVERSARIES.map((adv, index) => ({
                ...adv,
                simId: `adv-master-${Date.now()}-${index}`
            }));
        } else { throw new Error("Invalid JSON structure. Expected a top-level array '[...]'"); }
        printToLog(`Successfully loaded and populated ${adversaryPool.length} adversaries.`);
    } catch (error) {
        printToLog(`--- FATAL ERROR --- Could not load SRD Adversary JSON: ${error.message}`);
    }
}

async function loadPCDatabase() {
    try {
        // --- FIX: Corrected path to 'data/' folder ---
        const response = await fetch('data/premade_characters.json'); 
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        const data = await response.json(); 
        if (data && Array.isArray(data.players)) {
            PREMADE_CHARACTERS = data.players;
            playerPool = PREMADE_CHARACTERS.map((pc, index) => ({
                ...pc,
                simId: `player-${Date.now()}-${index}`
            }));
        } else { throw new Error("Invalid JSON structure. Expected an object with a 'players' array."); }
        printToLog(`Successfully loaded and populated ${playerPool.length} PCs.`);
    } catch (error) {
        printToLog(`--- FATAL ERROR --- Could not load Premade PC JSON: ${error.message}`);
    }
}

async function loadEnvironmentDatabase() {
    try {
        // --- FIX: Corrected path to 'data/' folder ---
        const response = await fetch('data/environments.json');
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        const data = await response.json();
        if (Array.isArray(data)) {
            PLACEHOLDER_ENVIRONMENTS = data; 
            environmentPool = PLACEHOLDER_ENVIRONMENTS.map((env, index) => ({
                ...env,
                simId: env.simId || `env-master-${Date.now()}-${index}`
            }));
        } else { throw new Error("Invalid JSON structure. Expected a top-level array '[...]'"); }
        printToLog(`Successfully loaded ${environmentPool.length} environments.`);
    } catch (error) {
        printToLog(`--- FATAL ERROR --- Could not load Environment JSON: ${error.message}`);
    }
}

// --- NEW: Battle Point Functions ---
function getAdversaryBattlePoints(advType) {
    switch(advType) {
        case 'Minion':
        case 'Social':
        case 'Support':
            return 1;
        case 'Horde':
        case 'Ranged':
        case 'Skulk':
        case 'Standard':
            return 2;
        case 'Leader':
            return 3;
        case 'Bruiser':
            return 4;
        case 'Solo':
            return 5;
        default:
            return 0;
    }
}

function calculateTargetBP() {
    if (activeParty.length === 0) return 0;
    [cite_start]// SRD Rule: (3 * # of PCs) + 2 [cite: 14725]
    return (3 * activeParty.length) + 2;
}

function updateBPCounter() {
    const targetBP = calculateTargetBP();
    let spentBP = 0;

    // Sum BP from ALL encounter blocks
    Object.values(activeAdversaries).forEach(encounterList => {
        encounterList.forEach(adv => {
            spentBP += getAdversaryBattlePoints(adv.type);
        });
    });

    document.getElementById('pc-count').textContent = activeParty.length;
    document.getElementById('bp-target-display').textContent = `Target BP: ${targetBP} / Short Rest`;
    const trackerDisplay = document.getElementById('bp-tracker-display');
    trackerDisplay.textContent = `Spent BP: ${spentBP} / ${targetBP}`;

    // Apply color coding
    trackerDisplay.className = 'bp-tracker'; // Reset classes
    if (spentBP > targetBP) {
        trackerDisplay.classList.add('bp-red');
    } else if (spentBP === targetBP || spentBP === targetBP - 1) {
        trackerDisplay.classList.add('bp-green');
        if (spentBP === targetBP) {
            trackerDisplay.classList.add('bp-green-bold');
        }
    } else if (spentBP > 0) {
        trackerDisplay.classList.add('bp-yellow');
    }

    // Enable/Disable sequence button
    const seqButton = document.getElementById('run-sequence-button');
    if (seqButton) {
        seqButton.disabled = (activeParty.length === 0 || spentBP === 0 || !activeEnvironment);
    }
}

// Helper function to calculate complexity
function getAdversaryComplexity(adv) {
    if (!adv.features) return 0;
    const featureCount = adv.features.length;
    if (featureCount <= 2) return 1;
    if (featureCount <= 4) return 2;
    return 3;
}

// Helper to render complexity stars
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
    if (!target.closest('button.move-button')) return; 
    
    const agentItem = target.closest('.pool-item');
    if (!agentItem) return;

    const agentId = agentItem.dataset.id;
    if (!agentId) return; 

    const parentListId = agentItem.parentElement.id;

    if (parentListId === 'player-pool-list') {
        let player = playerPool.find(p => p.simId === agentId);
        if (player) {
            const newPlayerInstance = JSON.parse(JSON.stringify(player));
            newPlayerInstance.simId = `player-instance-${Date.now()}-${Math.random()}`;
            activeParty.push(newPlayerInstance);
            printToLog(`Copied ${newPlayerInstance.name} to Active Scene.`);
            renderActiveScene();
        }
    } else if (parentListId === 'adversary-pool-list') {
        let agentTemplate = adversaryPool.find(a => a.simId === agentId);
        if (agentTemplate) {
            // Find the *last* available encounter list
            const lastEncounterId = encounterCount;
            const listKey = `encounter-${lastEncounterId}`;
            
            const list = document.getElementById(`active-adversary-list-${lastEncounterId}`);
            if (list && list.dataset.locked === 'true') {
                printToLog(`Error: Encounter ${lastEncounterId} is locked. Please add a new encounter to add adversaries.`);
                return;
            }

            const newAgentInstance = JSON.parse(JSON.stringify(agentTemplate));
            newAgentInstance.simId = `adv-instance-${Date.now()}-${Math.random()}`;
            newAgentInstance.bp = getAdversaryBattlePoints(newAgentInstance.type); // Add BP cost
            
            activeAdversaries[listKey].push(newAgentInstance);
            printToLog(`Copied ${newAgentInstance.name} to Encounter ${lastEncounterId}.`);
            renderActiveScene();
        }
    } else if (parentListId === 'environment-pool-list') {
        let envTemplate = environmentPool.find(e => e.simId === agentId);
        if (envTemplate) {
            activeEnvironment = JSON.parse(JSON.stringify(envTemplate));
            activeEnvironment.simId = `env-instance-${Date.now()}-${Math.random()}`;
            printToLog(`Set Active Environment to: ${activeEnvironment.name}.`);
            renderActiveEnvironment();
        }
    }
    updateBPCounter(); // Update BP total
}

function handleSceneClick(event) {
    const target = event.target;
    if (!target.classList.contains('move-button')) return; 
    const agentItem = target.closest('.scene-item');
    if (!agentItem) return;
    
    const agentId = agentItem.dataset.id;
    if (!agentId) return;

    const parentList = agentItem.parentElement;

    // Check Party
    if (parentList.id === 'active-party-list') {
        let playerIndex = activeParty.findIndex(p => p.simId === agentId);
        if (playerIndex > -1) {
            const agent = activeParty.splice(playerIndex, 1)[0];
            printToLog(`Removed ${agent.name} instance from Active Scene.`);
            renderActiveScene();
        }
    }
    // Check Adversaries (now checks all possible lists)
    else if (parentList.classList.contains('active-adversary-list')) {
        const encounterId = parentList.id.split('-').pop();
        const listKey = `encounter-${encounterId}`;
        let adversaryIndex = activeAdversaries[listKey].findIndex(a => a.simId === agentId);
        if (adversaryIndex > -1) {
            const agent = activeAdversaries[listKey].splice(adversaryIndex, 1)[0];
            printToLog(`Removed ${agent.name} from Encounter ${encounterId}.`);
            renderActiveScene();
        }
    }
    // Check Environment
    else if (parentList.id === 'active-environment-list') {
        if (activeEnvironment && activeEnvironment.simId === agentId) {
            printToLog(`Removed ${activeEnvironment.name} from Active Scene.`);
            activeEnvironment = null;
            renderActiveEnvironment();
        }
    }
    updateBPCounter(); // Update BP total
}

// --- DYNAMIC UI RENDERING ---
function renderPools() {
    const playerListDiv = document.getElementById('player-pool-list');
    const adversaryListDiv = document.getElementById('adversary-pool-list');
    playerListDiv.innerHTML = '';
    adversaryListDiv.innerHTML = '';

    const pcClassFilter = document.getElementById('pc-pool-class-filter').value;
    const pcLevelFilter = document.getElementById('pc-pool-level-filter').value;
    const advTierFilter = document.getElementById('adv-pool-tier-filter').value;
    const advTypeFilter = document.getElementById('adv-pool-type-filter').value;

    const filteredPlayers = playerPool.filter(char => {
        const isManual = !char.class || !char.level;
        if (isManual) return (pcClassFilter === 'all' && pcLevelFilter === 'all');
        const classMatch = (pcClassFilter === 'all' || char.class.name === pcClassFilter);
        const levelMatch = (pcLevelFilter === 'all' || char.level == pcLevelFilter);
        return classMatch && levelMatch;
    });

    const filteredAdversaries = adversaryPool.filter(adv => {
        const isManual = !adv.tier || !adv.type;
        if (isManual) return (advTierFilter === 'all' && advTypeFilter === 'all');
        const tierMatch = (advTierFilter === 'all' || adv.tier == advTierFilter);
        const typeMatch = (advTypeFilter === 'all' || adv.type === advTypeFilter);
        return tierMatch && typeMatch;
    });

    filteredPlayers.forEach(char => {
        const level = char.level || 'Custom';
        const className = char.class?.name || 'JSON';
        playerListDiv.innerHTML += `
        <div class="pool-item" data-id="${char.simId}">
            <span class="agent-name">${char.name} (Lvl ${level} ${className})</span>
            <div class="pool-item-controls">
                <button class="move-button" title="Add to Active Scene">&gt;</button>
            </div>
        </div>`;
    });

    filteredAdversaries.forEach(adv => {
        const difficulty = adv.difficulty || 'N/A';
        const complexity = getAdversaryComplexity(adv);
        const complexityStars = renderComplexityStars(complexity);
        const bp = getAdversaryBattlePoints(adv.type); // Get BP
        let features = "No features listed.";
        if (adv.features && adv.features.length > 0) {
             features = adv.features.map(f => `• ${f.name} (${f.type})`).join('\n');
        }

        adversaryListDiv.innerHTML += `
        <div class="pool-item" data-id="${adv.simId}" title="${features}">
            <span class="agent-name">${adv.name} (Diff ${difficulty}) ${complexityStars} (BP: ${bp})</span>
            <div class="pool-item-controls">
                <button class="move-button" title="Add to Active Scene">&gt;</button>
            </div>
        </div>`;
    });

    if (filteredPlayers.length === 0 && playerPool.length > 0) {
        playerListDiv.innerHTML = `<div class="pool-item"><span>No players match filters.</span></div>`;
    }
    if (filteredAdversaries.length === 0 && adversaryPool.length > 0) {
        adversaryListDiv.innerHTML = `<div class="pool-item"><span>No adversaries match filters.</span></div>`;
    }
}

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
        </div>`;
    });
}

function renderActiveScene() {
    // Render Party
    const partyListDiv = document.getElementById('active-party-list');
    partyListDiv.innerHTML = '';
    activeParty.forEach(char => {
        partyListDiv.innerHTML += `
        <div class="scene-item" data-id="${char.simId}">
            <button class="move-button" title="Remove from Scene">&lt;</button>
            <span class="agent-name">${char.name} (Lvl ${char.level})</span>
        </div>`;
    });

    // Render All Adversary Encounters
    Object.keys(activeAdversaries).forEach(encounterKey => {
        const listId = `active-adversary-list-${encounterKey.split('-').pop()}`;
        const adversaryListDiv = document.getElementById(listId);
        
        if (adversaryListDiv) {
            adversaryListDiv.innerHTML = '';
            activeAdversaries[encounterKey].forEach(adv => {
                adversaryListDiv.innerHTML += `
                <div class="scene-item" data-id="${adv.simId}">
                    <button class="move-button" title="Remove from Scene">&lt;</button>
                    <span class="agent-name">${adv.name} (Diff ${adv.difficulty}) (BP: ${adv.bp})</span>
                </div>`;
            });
        }
    });
}

function renderActiveEnvironment() {
    const activeEnvDiv = document.getElementById('active-environment-list');
    activeEnvDiv.innerHTML = '';
    if (activeEnvironment) {
        activeEnvDiv.innerHTML += `
        <div class="scene-item" data-id="${activeEnvironment.simId}">
            <button class="move-button" title="Remove from Scene">&lt;</button>
            <span class="agent-name">${activeEnvironment.name} (Diff ${activeEnvironment.difficulty})</span>
        </div>`;
    }
    updateBPCounter();
}

// --- NEW: Multi-Encounter Functions ---
function addNewEncounterBlock() {
    encounterCount++;
    const plannerArea = document.getElementById('encounter-planner-area');

    // Create the new block
    const newBlock = document.createElement('div');
    newBlock.className = 'encounter-block';
    newBlock.id = `encounter-${encounterCount}`;

    // Initialize the adversary list for this new encounter
    activeAdversaries[`encounter-${encounterCount}`] = [];

    newBlock.innerHTML = `
        <button class="toggle-button" data-target="encounter-${encounterCount}-body">▼</button>
        <h4>Encounter ${encounterCount}</h4>
        <div class="encounter-body" id="encounter-${encounterCount}-body">
            <div class="pool-container">
                <div class="pool-header">
                    <h4>Active Adversaries</h4>
                </div>
                <div id="active-adversary-list-${encounterCount}" class="agent-list active-adversary-list">
                    </div>
            </div>
        </div>
    `;
    
    plannerArea.appendChild(newBlock);
    
    // Add event listener to the new toggle button
    newBlock.querySelector('.toggle-button').addEventListener('click', toggleEncounterBlock);

    // Disable adding adversaries to previous lists
    document.querySelectorAll('.active-adversary-list').forEach((list, index) => {
        if (index < encounterCount - 1) { // -1 because index is 0-based
            list.closest('.pool-container').style.opacity = '0.6';
            list.dataset.locked = 'true';
        }
    });

    // Enable the "Run Full Sequence" button
    const seqButton = document.getElementById('run-sequence-button');
    if (seqButton) {
        seqButton.disabled = (activeParty.length === 0 || !activeEnvironment);
        updateBPCounter(); // Re-check button state
    }
}

function toggleEncounterBlock(event) {
    const button = event.currentTarget;
    const targetId = button.dataset.target;
    const body = document.getElementById(targetId);

    if (body.style.display === 'none') {
        body.style.display = 'block';
        button.textContent = '▼';
    } else {
        body.style.display = 'none';
        button.textContent = '▶';
    }
}


// --- PARSING & INSTANTIATION FUNCTIONS ---
function instantiatePlayerAgent(data) {
    let spellcastTrait = null;
    if (data.subclass.spellcast_trait) {
        spellcastTrait = data.subclass.spellcast_trait.toLowerCase();
    }
    let max_hp = data.class.starting_hp;
    if (data.advancementsTaken && data.advancementsTaken.add_hp) {
        max_hp += data.advancementsTaken.add_hp;
    }
    let max_stress = 6;
    if (data.advancementsTaken && data.advancementsTaken.add_stress) {
        max_stress += data.advancementsTaken.add_stress;
    }
    if (data.class.name === "Guardian" && data.subclass.foundation_feature.name.includes("At Ease")) {
        max_stress += 1;
    }
    
    let current_hope = 2;
    const agent = {
        id: data.simId,
        name: data.name,
        type: 'player',
        class: data.class.name,
        current_hp: max_hp,
        max_hp: max_hp,
        current_stress: 0,
        max_stress: max_stress,
        current_hope: current_hope,
        max_hope: 6,
        armor_slots: data.equipment.armor ? data.equipment.armor.score : 0,
        current_armor_slots: data.equipment.armor ? data.equipment.armor.score : 0,
        traits: data.traits,
        spellcastTrait: spellcastTrait,
        proficiency: data.proficiency,
        evasion: data.evasion,
        thresholds: {
            major: data.majorThreshold,
            severe: data.severeThreshold
        },
        primary_weapon: data.equipment.primary,
        features: data.features,
        domainCards: data.domainCards,
        experiences: data.experiences,
        conditions: [],
        position: {
            x: Math.floor(Math.random() * 3) + 1, 
            y: Math.floor(Math.random() * CURRENT_BATTLEFIELD.MAX_Y) + 1 
        },
        speed: DAGGERHEART_RANGES.RANGE_CLOSE
    };
    return agent;
}

function instantiateAdversaryAgent(data) {
    const attackBonus = data.attack.bonus !== undefined
        ? data.attack.bonus
        : parseInt(data.attack.modifier) || 0;

    let agent = {
        ...data,
        id: data.simId,
        type: 'adversary',
        current_hp: data.hp,
        max_hp: data.hp,
        current_stress: 0,
        max_stress: data.stress,
        attack: {
            ...data.attack,
            modifier: attackBonus
        },
        // --- BUG FIX: Create the thresholds object from root properties ---
        thresholds: {
            major: data.major,
            severe: data.severe
        },
        // --- END BUG FIX ---
        bp: getAdversaryBattlePoints(data.type), // Add BP
        conditions: [],
        passives: {},
        position: {
            x: CURRENT_BATTLEFIELD.MAX_X - Math.floor(Math.random() * 3),
            y: Math.floor(Math.random() * CURRENT_BATTLEFIELD.MAX_Y) + 1
        },
        speed: DAGGERHEART_RANGES.RANGE_CLOSE
    };
    applyPassiveFeatures(agent);
    return agent;
}

function applyPassiveFeatures(agent) {
    if (!agent.features) return;
    for (const feature of agent.features) {
        if (feature.type === 'passive' && feature.parsed_effect) {
            for (const action of feature.parsed_effect.actions) {
                if (action.action_type === 'MODIFY_DAMAGE' && action.target === 'ALL_ATTACKS' && action.details.is_direct) {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}. All attacks are DIRECT.)`);
                    agent.passives.allAttacksAreDirect = true;
                }
                if (action.action_type === 'MODIFY_STAT' && action.details.stat === 'resistance') {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}.)`);
                    agent.passives.resistance = action.details.value;
                }
                if (action.action_type === 'MODIFY_STAT' && action.details.stat === 'max_spotlights_per_turn') {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}. Can be spotlighted ${action.details.value} times.)`);
                    agent.maxSpotlights = action.details.value;
                }
                if (action.action_type === 'MODIFY_ACTION' && action.details.action === 'SPOTLIGHT') {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}. Spotlight cost modified.)`);
                    agent.passives.spotlightCost = action.details.cost.value;
                }
                if (action.action_type === 'MODIFY_ATTACK' && action.target === 'STANDARD_ATTACK') {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}. Standard attack is modified.)`);
                    agent.passives.attackAllInRange = (action.details.new_target === 'ALL_IN_RANGE');
                }
                if (action.action_type === 'MODIFY_DAMAGE_TAKEN' && action.trigger === 'ON_TAKE_HP_PHY') {
                     simLog(` (Passive Applied: ${agent.name} has ${feature.name}. Takes extra HP from Physical.)`);
                     agent.passives.takeExtraPhysicalHP = action.details.increase_hp_marked;
                }
                if (action.action_type === 'KNOCKBACK' && action.trigger === 'ON_DEAL_HP_STANDARD_ATTACK') {
                    simLog(` (Passive Applied: ${agent.name} has ${feature.name}.)`);
                    agent.passives.knockbackOnHP = {
                        range: action.range
                    };
                }
            }
        }
    }
}

// --- *** SIMULATION RUNNER *** ---

// This function runs a BATCH of standalone sims for Encounter 1
async function runMultipleSimulations(count) {
    const title = count === 1 ? "Run 1 Sim (Encounter 1)" : `Batch of ${count} Sims (Encounter 1 only)`;
    printToLog(`\n===== STARTING: ${title} =====`);
    
    simHistory = [];
    const playbackBtn = document.getElementById('playback-button');
    if (playbackBtn) playbackBtn.disabled = true;

    for (let i = 1; i <= count; i++) {
        // Run the simulation synchronously.
        runSingleEncounter(1, `Encounter 1 (Sim ${i}/${count})`, null, count > 1); // null = fresh state, true = isBatch
        
        // "Breathe" to prevent freezing
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    printToLog(`\n===== BATCH COMPLETE =====`);

    if (count === 1 && simHistory.length === 1 && simHistory[0].playbackLog) {
        if (playbackBtn) playbackBtn.disabled = false;
    }
}

// This function runs the FULL SEQUENCE of encounters, 1 time
async function runFullEncounterSequence() {
    printToLog(`\n===== STARTING FULL ENCOUNTER SEQUENCE (1 Time) =====`);
    simHistory = []; // Clear history for playback
    const playbackBtn = document.getElementById('playback-button');
    if (playbackBtn) playbackBtn.disabled = true;

    // --- 1. Create Initial Game State ---
    const mapSize = document.getElementById('map-size-select').value;
    CURRENT_BATTLEFIELD = { ...DAGGERHEART_RANGES, ...MAP_CONFIGS[mapSize] };
    const sceneDifficulty = activeEnvironment ? activeEnvironment.difficulty : 10;
    
    let playerAgents;
    try {
        playerAgents = activeParty.map(instantiatePlayerAgent);
    } catch (e) {
        printToLog(`--- FATAL ERROR (PLAYERS) --- \n${e.message}`);
        return;
    }
    
    if (playerAgents.length === 0) {
        printToLog(`--- FATAL ERROR --- \nAdd players to the Active Party to run a sequence.`);
        return;
    }
    if (!activeEnvironment) {
        printToLog(`--- FATAL ERROR --- \nAdd an Active Environment to run a sequence.`);
        return;
    }

    let sharedGameState = {
        players: playerAgents,
        adversaries: [], // Will be loaded per encounter
        hope: 2 * playerAgents.length,
        fear: 1 * playerAgents.length,
        spotlight: 0,
        lastPlayerSpotlight: 0,
        sceneDifficulty: sceneDifficulty
    };

    // --- 2. Loop through each encounter block ---
    for (let i = 1; i <= encounterCount; i++) {
        const encounterKey = `encounter-${i}`;
        const adversaryList = activeAdversaries[encounterKey];
        
        if (!adversaryList || adversaryList.length === 0) {
            printToLog(`\n--- SKIPPING ENCOUNTER ${i} (No adversaries) ---`);
            continue;
        }

        printToLog(`\n--- STARTING ENCOUNTER ${i} ---`);

        // --- 3. Run the single encounter ---
        // We pass the *shared* gameState to be modified in-place
        runSingleEncounter(i, `Encounter ${i}`, sharedGameState, false); // false = not a batch

        // --- 4. Check for TPK ---
        const playersAlive = sharedGameState.players.some(p => p.current_hp > 0);
        if (!playersAlive) {
            printToLog(`\n--- PARTY DEFEATED! --- \nSequence halted after Encounter ${i}.`);
            break; // Stop the sequence
        }
        
        if (i < encounterCount) {
            printToLog(`\n--- ENCOUNTER ${i} COMPLETE --- \nParty moves to the next encounter...`);
            // Add a "breathe" here for UI update
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    printToLog(`\n===== FULL SEQUENCE COMPLETE =====`);
    
    // Enable playback for the *last* simulation run
    if (simHistory.length > 0 && simHistory[simHistory.length-1].playbackLog) {
        if (playbackBtn) playbackBtn.disabled = false;
    }
}

// *** THIS IS THE MISSING FUNCTION ***
function exportLog() {
    const logOutput = document.getElementById('log-output');
    // Use innerText to capture all text content, including line breaks
    const logContent = logOutput.innerText; 
    
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dhmc_simulation_log_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    printToLog(`\n--- Log exported! ---`);
}
// *** END OF MISSING FUNCTION ***


// --- *** THE CORE SIMULATION FUNCTION *** ---
// encounterIndex = The number of the encounter (1, 2, 3...)
// title = A string for logging (e.g., "Encounter 1 (Sim 1/5)")
// existingGameState = If provided, use this state instead of creating a new one
// isBatch = Is this part of a "Run x Sims" batch? (affects logging)
function runSingleEncounter(encounterIndex, title, existingGameState = null, isBatch = false) {
    const recordPlayback = !isBatch; // Only record playback for single runs or sequences
    BATCH_LOG = []; // Always reset the log for a new sim

    simLog(`======================================`);
    simLog(`INITIALIZING ${title}...`);
    simLog('======================================');

    let gameState;
    let adversaryAgents;
    const adversaryList = activeAdversaries[`encounter-${encounterIndex}`];

    if (existingGameState) {
        // --- CARRY-OVER LOGIC ---
        simLog("...Carrying over Player/GM state...");
        gameState = existingGameState;

        // Instantiate *new* adversaries for this encounter
        try {
            adversaryAgents = adversaryList.map(instantiateAdversaryAgent);
        } catch (e) {
            simLog(`--- ERROR (Adversaries) --- \n${e.message}`);
            printToLog(BATCH_LOG.join('\n')); BATCH_LOG = []; return;
        }
        gameState.adversaries = adversaryAgents; // Overwrite old adversaries
        gameState.spotlight = 0; // Reset spotlight to PCs
        gameState.lastPlayerSpotlight = 0;
        
    } else {
        // --- FRESH SIM LOGIC (Encounter 1 only) ---
        const mapSize = document.getElementById('map-size-select').value;
        CURRENT_BATTLEFIELD = { ...DAGGERHEART_RANGES, ...MAP_CONFIGS[mapSize] };
        const sceneDifficulty = activeEnvironment ? activeEnvironment.difficulty : 10;
        
        simLog(`Simulating on ${mapSize} map (${CURRENT_BATTLEFIELD.MAX_X}x${CURRENT_BATTLEFIELD.MAX_Y})...`);
        simLog(`Active Environment Difficulty set to: ${sceneDifficulty}`);
        
        if (activeParty.length === 0) { 
            simLog('--- ERROR --- \nAdd a player to the Active Scene.');
            printToLog(BATCH_LOG.join('\n')); BATCH_LOG = []; return; 
        }
        if (!adversaryList || adversaryList.length === 0) { 
            simLog(`--- ERROR --- \nAdd an adversary to Encounter ${encounterIndex}.`); 
            printToLog(BATCH_LOG.join('\n')); BATCH_LOG = []; return; 
        }
        if (!activeEnvironment) {
            simLog('--- ERROR --- \nAdd an environment to the Active Scene.');
            printToLog(BATCH_LOG.join('\n')); BATCH_LOG = []; return; 
        }

        try {
            let playerAgents = activeParty.map(instantiatePlayerAgent);
            adversaryAgents = adversaryList.map(instantiateAdversaryAgent);
            gameState = {
                players: playerAgents,
                adversaries: adversaryAgents,
                hope: 2 * playerAgents.length,
                fear: 1 * playerAgents.length,
                spotlight: 0,
                lastPlayerSpotlight: 0,
                sceneDifficulty: sceneDifficulty
            };
        } catch (e) {
            simLog(`--- ERROR --- \nFailed to parse agent JSON. \n${e.message}`);
            printToLog(BATCH_LOG.join('\n')); BATCH_LOG = []; return; 
        }
    }

    let currentPlaybackLog = [];
    const startTime = Date.now();

    simLog(`Simulation Initialized. Hope: ${gameState.hope}, Fear: ${gameState.fear}`);
    
    let roundCounter = 0; 
    const maxRounds = 100;

    while (!isCombatOver(gameState) && roundCounter < maxRounds) {
        let lastOutcome = '';
        
        if (recordPlayback) {
            recordSnapshot(gameState, currentPlaybackLog);
        }

        if (gameState.spotlight === 'GM') {
            lastOutcome = executeGMTurn(gameState);
            roundCounter++;
            simLog(` --- Round ${roundCounter} ---`);
        } else {
            const actingPlayer = gameState.players[gameState.spotlight];
            if (actingPlayer.current_hp > 0) {
                lastOutcome = executePCTurn(actingPlayer, gameState);
                gameState.lastPlayerSpotlight = gameState.spotlight;
            } else {
                lastOutcome = 'PC_DOWN';
            }
        }
        
        determineNextSpotlight(lastOutcome, gameState);
        
        if (isCombatOver(gameState)) {
            break;
        }
    }
    
    if (roundCounter >= maxRounds) {
         simLog(`--- SIMULATION HALTED --- \nReached max round limit (100).`);
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    if (recordPlayback) {
        recordSnapshot(gameState, currentPlaybackLog);
    }

    const playersAlive = gameState.players.some(p => p.current_hp > 0);
    const winner = playersAlive ? "Players" : "Adversaries";
    simLog(`\n--- SIMULATION COMPLETE ---`);
    simLog(`Winner: ${winner} in ${roundCounter} rounds.`);
    simLog(`Duration: ${duration.toFixed(3)}s`);

    const scoreboard = generateScoreboard(gameState, winner);
    const winnerClass = winner === "Players" ? "scoreboard-win" : "scoreboard-loss";
    
    simHistory.push({
        id: simHistory.length + 1,
        title: title, // Add title for playback context
        winner: winner,
        rounds: roundCounter,
        duration: duration,
        playbackLog: currentPlaybackLog.length > 0 ? currentPlaybackLog : null
    });
    
    const finalLogText = BATCH_LOG.join('\n');
    BATCH_LOG = []; // Clear log for next run
    
    // For batch sims, just print a summary. For single sims, print all.
    if (isBatch) { 
        printToLog(`--- ${title} Summary: Winner: ${winner} in ${roundCounter} rounds.`);
    } else { // This is a single run or a sequence run
        printToLog(finalLogText);
        printToLog(scoreboard, winnerClass);
    }
    
    // Enable playback button if this was a single, non-batch run
    if (recordPlayback && simHistory.length > 0 && simHistory[simHistory.length-1].playbackLog) {
        const playbackBtn = document.getElementById('playback-button');
        if (playbackBtn) playbackBtn.disabled = false;
    }
}
// --- *** END OF CORE SIMULATION FUNCTION *** ---


// --- NEW: SCOREBOARD GENERATOR (Condensed) ---
function generateScoreboard(gameState, winner) {
    let board = [];
    board.push(`\n--- PLAYER CHARACTERS (Hope: ${gameState.hope}) ---`);
    
    gameState.players.forEach(p => {
        const status = p.current_hp > 0 ? "ALIVE" : "DEFEATED";
        const line = `  ${p.name} (${p.class}):`.padEnd(30) + `${status.padEnd(10)} HP: ${String(p.current_hp).padStart(2)} / ${p.max_hp} | Stress: ${p.current_stress} / ${p.max_stress}`;
        board.push(line);
    });

    board.push(`\n--- ADVERSARIES (Fear: ${gameState.fear}) ---`);
    gameState.adversaries.forEach(a => {
        const status = a.current_hp > 0 ? "ALIVE" : "DEFEATED";
        const line = `  ${a.name} (${a.type}):`.padEnd(30) + `${status.padEnd(10)} HP: ${String(a.current_hp).padStart(2)} / ${a.max_hp}`;
        board.push(line);
    });
    board.push(`\n========== FINAL SCOREBOARD (Winner: ${winner}) ==========`);
    return board.join('\n');
}


// --- MODIFIED: Uses simLog ---
function recordSnapshot(gameState, playbackLog) {
    const snapshot = {
        players: gameState.players.map(p => ({
            id: p.id, name: p.name, current_hp: p.current_hp, position: { ...p.position }
        })),
        adversaries: gameState.adversaries.map(a => ({
            id: a.id, name: a.name, current_hp: a.current_hp, position: { ...a.position }
        }))
    };
    playbackLog.push(snapshot);
}

// --- MODIFIED: Uses printToLog ---
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
    
    printToLog(`\n\n=== STARTING REPLAY OF SIMULATION #${simData.id} (${simData.title}) ===`);

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

// --- MODIFIED: Uses simLog ---
function findNextLivingPC(gameState) {
    const { players, lastPlayerSpotlight } = gameState;
    let nextIndex = (lastPlayerSpotlight + 1) % players.length;
    for (let i = 0; i < players.length; i++) {
        if (players[nextIndex].current_hp > 0) {
            return nextIndex; 
        }
        nextIndex = (nextIndex + 1) % players.length;
    }
    return -1;
}

// --- MODIFIED: Uses simLog ---
function determineNextSpotlight(lastOutcome, gameState) {
    simLog(` Control Flow: Last outcome was [${lastOutcome}]`);
    if (isCombatOver(gameState)) {
        simLog(` --- Combat is Over ---`);
        return; 
    }
    let nextPCIndex;
    switch (lastOutcome) {
        case 'CRITICAL_SUCCESS':
        case 'PC_DOWN':
            nextPCIndex = findNextLivingPC(gameState);
            if (nextPCIndex === -1) return;
            gameState.spotlight = nextPCIndex;
            simLog(` Spotlight passes to PC: ${gameState.players[nextPCIndex].name}`);
            break;
        case 'SUCCESS_WITH_HOPE':
            if (gameState.fear > 0 && Math.random() < 0.5) { 
                simLog(`PC succeeded with Hope, but GM spends 1 Fear to seize the spotlight!`);
                gameState.fear = Math.max(0, gameState.fear - 1);
                simLog(` GM Fear: ${gameState.fear}`);
                gameState.spotlight = 'GM';
            } else {
                nextPCIndex = findNextLivingPC(gameState);
                if (nextPCIndex === -1) return; 
                gameState.spotlight = nextPCIndex;
                simLog(` Spotlight passes to PC: ${gameState.players[nextPCIndex].name}`);
            }
            break;
        case 'SUCCESS_WITH_FEAR':
        case 'FAILURE_WITH_HOPE': 
        case 'FAILURE_WITH_FEAR':
            gameState.spotlight = 'GM';
            simLog(` Spotlight seized by GM!`);
            break;
        case 'GM_TURN_COMPLETE':
            nextPCIndex = findNextLivingPC(gameState);
            if (nextPCIndex === -1) return;
            gameState.spotlight = nextPCIndex;
            simLog(` Spotlight returns to PC: ${gameState.players[nextPCIndex].name}`);
            break;
        case 'COMBAT_OVER':
            break;
    }
}

// --- MODIFIED: Uses simLog & checks range *before* moving ---
function executePCTurn(player, gameState) {
    let targets = gameState.adversaries.filter(a => a.current_hp > 0);
    if (targets.length === 0) return 'COMBAT_OVER';
    
    const target = targets.sort((a, b) => {
        let distA = getAgentDistance(player, a);
        let distB = getAgentDistance(player, b);
        return distA - distB;
    })[0];

    simLog(`> ${player.name}'s turn (targeting ${target.name} at (${target.position.x}, ${target.position.y}))...`);

    const chosenAction = choosePCAction(player, target, gameState);
    let result;

    if (chosenAction) {
        // --- PC MOVE & ACTION (Close Range) ---
        [cite_start]// Per SRD, "you can move to a location within Close range as part of that action." [cite: 13912]
        // We assume the PC moves into range for their chosen action if they aren't already.
        if (!isTargetInRange(player, target, chosenAction.range)) {
            simLog(` -> Moving to ${chosenAction.range} range...`);
            moveAgentTowards(player, target, gameState, false); // Standard Close move
        }
        
        switch (chosenAction.type) {
            case 'SPELL':
                result = executePCSpell(player, chosenAction.card, target, gameState);
                break;
            case 'ATTACK':
                result = executePCBasicAttack(player, target, gameState);
                break;
            default:
                simLog(`(ERROR: Unknown action type: ${chosenAction.type})`);
                result = { outcome: 'FAILURE_WITH_FEAR' }; // Failsafe
        }
    } else {
        // --- PC SPRINT (Far/Very Far Range) ---
        [cite_start]// Per SRD, "you need to succeed on an Agility Roll to safely reposition yourself." [cite: 13913]
        simLog(` -> ${target.name} is out of range of all options. Sprinting closer (Agility Roll).`);
        moveAgentTowards(player, target, gameState, true); // true = isSprint
        
        simLog(` -> Making Agility roll to move...`);
        result = executeActionRoll(gameState.sceneDifficulty, player.traits.agility || 0, 0); //
        simLog(` Roll: agility (${player.traits.agility || 0}) | Total ${result.total} vs Diff ${gameState.sceneDifficulty} (${result.outcome})`);
    }
    
    processRollResources(result, gameState, player);
    return result.outcome;
}

// --- MODIFIED: Uses simLog & adds .range to actions ---
function choosePCAction(player, target, gameState) {
    let possibleActions = [];
    // 1. Check Domain Cards
    for (const card of player.domainCards) {
        switch (card.name) {
            case "Vicious Entangle": // Ranger
                if (isTargetInRange(player, target, "Far")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 1, name: "Vicious Entangle", range: "Far" });
                }
                break;
            case "Bolt Beacon": // Wizard
                if (player.current_hope >= 1 && isTargetInRange(player, target, "Far")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 1, name: "Bolt Beacon", range: "Far" });
                }
                break;
            case "Book Of Illiat": // Bard / Wizard
                if (isTargetInRange(player, target, "Very Close")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 2, name: "Slumber", range: "Very Close" });
                }
                break;
        }
    }
    // 2. Check Basic Attack
    const weaponRange = player.primary_weapon.range;
    if (isTargetInRange(player, target, weaponRange)) {
        possibleActions.push({ type: 'ATTACK', priority: 0, name: `Basic Attack (${player.primary_weapon.name})`, range: weaponRange });
    }
    // 3. Decide which action to take
    if (possibleActions.length === 0) {
        return null; // No actions possible, must move
    }
    possibleActions.sort((a, b) => b.priority - a.priority);
    
    simLog(` -> ${player.name} considered: [${possibleActions.map(a => a.name).join(', ')}]`);
    
    const bestAction = possibleActions[0];
    simLog(` -> Decided on: ${bestAction.name}`);
    return bestAction;
}

// --- MODIFIED: Uses simLog ---
function executePCBasicAttack(player, target, gameState) {
    simLog(` -> Attacking with ${player.primary_weapon.name}!`);
    const traitName = player.primary_weapon.trait.toLowerCase();
    const traitMod = player.traits[traitName];
    
    const result = executeActionRoll(target.difficulty, traitMod, 0);
    simLog(` Roll: ${traitName} (${traitMod}) | Total ${result.total} vs Diff ${target.difficulty} (${result.outcome})`);
    
    if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
        let damageString = player.primary_weapon?.damage || "1d4";
        let proficiency = player.proficiency;
        let critBonus = 0; 
        
        if (result.outcome === 'CRITICAL_SUCCESS') {
            simLog(' CRITICAL HIT!');
            critBonus = parseDiceString(damageString).maxDie; 
        }
        const damageTotal = rollDamage(damageString, proficiency, critBonus); 
        const damageInfo = { 
            amount: damageTotal, 
            isDirect: false, 
            isPhysical: (damageString.includes('phy')),
            isStandardAttack: true
        };
        applyDamage(damageInfo, player, target, gameState);
    }
    return result;
}

// --- MODIFIED: Uses simLog ---
function executePCSpell(player, card, target, gameState) {
    const traitMod = player.traits[player.spellcastTrait];
    let result;

    switch (card.name) {
        case "Vicious Entangle":
            simLog(` -> Casting "Vicious Entangle" on ${target.name}!`);
            result = executeActionRoll(target.difficulty, traitMod, 0);
            simLog(` Roll: ${player.spellcastTrait} (${traitMod}) | Total ${result.total} vs Diff ${target.difficulty} (${result.outcome})`);
            
            if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
                const damageTotal = rollDamage("1d8+1", 1, 0);
                const damageInfo = { amount: damageTotal, isDirect: false, isPhysical: true, isStandardAttack: false };
                applyDamage(damageInfo, player, target, gameState);
                applyCondition(target, "Restrained");
            }
            break;
        case "Bolt Beacon":
            simLog(` -> Casting "Bolt Beacon" on ${target.name}!`);
            if (player.current_hope < 1) {
                simLog(` -> Not enough Hope to cast! (Cost: 1)`);
                return { outcome: 'FAILURE_WITH_FEAR' };
            }
            player.current_hope--;
            simLog(` -> Spent 1 Hope (Total: ${player.current_hope})`);
            result = executeActionRoll(target.difficulty, traitMod, 0);
            simLog(` Roll: ${player.spellcastTrait} (${traitMod}) | Total ${result.total} vs Diff ${target.difficulty} (${result.outcome})`);
            
            if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
                const damageTotal = rollDamage("1d8+2", player.proficiency, 0);
                const damageInfo = { amount: damageTotal, isDirect: false, isPhysical: false, isStandardAttack: false };
                applyDamage(damageInfo, player, target, gameState);
                applyCondition(target, "Vulnerable");
            }
            break;
        case "Book Of Illiat":
            simLog(` -> Casting "Slumber" (from Book of Illiat) on ${target.name}!`);
            result = executeActionRoll(target.difficulty, traitMod, 0);
            simLog(` Roll: ${player.spellcastTrait} (${traitMod}) | Total ${result.total} vs Diff ${target.difficulty} (${result.outcome})`);
            if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
                applyCondition(target, "Asleep");
            }
            break;
        default:
            simLog(`(ERROR: AI does not know how to cast spell: ${card.name})`);
            return { outcome: 'FAILURE_WITH_FEAR' };
    }
    return result;
}

// --- MODIFIED: Uses simLog & new GM Movement ---
function executeGMTurn(gameState) {
    simLog(`> GM SPOTLIGHT:`);
    let adversaryToAct = getAdversaryToAct(gameState);
    if (adversaryToAct) {
        performAdversaryAction(adversaryToAct.adversary, adversaryToAct.target, gameState);
    } else {
        simLog(` (No living adversaries or players left.)`);
        return 'COMBAT_OVER';
    }
    let spotlightedAdversaries = [adversaryToAct.adversary.id]; 
    while (gameState.fear > 0 && !isCombatOver(gameState)) {
        if (Math.random() < 0.5) { 
            simLog(` GM decides to spend Fear for an *additional* spotlight...`);
            let spotlightCost = 1;
            const potentialNextAdversary = getAdversaryToAct(gameState, spotlightedAdversaries);
            if (potentialNextAdversary && potentialNextAdversary.adversary.passives.spotlightCost) {
                spotlightCost = potentialNextAdversary.adversary.passives.spotlightCost;
                simLog(` (${potentialNextAdversary.adversary.name}'s 'Ramp Up' makes this cost ${spotlightCost} Fear!)`);
            }
            if (gameState.fear < spotlightCost) {
                simLog(` (GM lacks the ${spotlightCost} Fear to continue.)`);
                break;
            }
            gameState.fear -= spotlightCost;
            simLog(` GM Fear: ${gameState.fear}`);
            let additionalAdversary = getAdversaryToAct(gameState, spotlightedAdversaries);
            if (additionalAdversary) {
                spotlightedAdversaries.push(additionalAdversary.adversary.id);
                performAdversaryAction(additionalAdversary.adversary, additionalAdversary.target, gameState);
            } else {
                simLog(` (No more available adversaries to act.)`);
                break;
            }
        } else {
            simLog(` GM chooses to hold their Fear and pass the spotlight.`);
            break; 
        }
    }
    return 'GM_TURN_COMPLETE'; 
}

// --- MODIFIED: Uses simLog ---
function getAdversaryToAct(gameState, actedThisTurn = []) {
    const livingPlayers = gameState.players.filter(p => p.current_hp > 0);
    if (livingPlayers.length === 0) return null; 
    let livingAdversaries = gameState.adversaries.filter(a => a.current_hp > 0);
    if (livingAdversaries.length === 0) return null; 
    let availableAdversaries = livingAdversaries.filter(a => {
        if (actedThisTurn.includes(a.id)) {
            const max = a.maxSpotlights || 1;
            const acted = actedThisTurn.filter(id => id === a.id).length;
            return acted < max;
        }
        return true;
    });
    if (availableAdversaries.length === 0) {
        simLog(` (All available adversaries have acted their max times this turn.)`);
        return null;
    }
    let adversary;
    let whoHaventActed = availableAdversaries.filter(a => !actedThisTurn.includes(a.id));
    if (whoHaventActed.length > 0) {
        adversary = whoHaventActed[Math.floor(Math.random() * whoHaventActed.length)];
    } else {
        adversary = availableAdversaries[Math.floor(Math.random() * availableAdversaries.length)];
    }
    const target = livingPlayers.sort((a, b) => {
        let distA = getAgentDistance(adversary, a);
        let distB = getAgentDistance(adversary, b);
        return distA - distB;
    })[0];
    return { adversary, target };
}

// --- MODIFIED: Uses simLog & new GM Movement ---
function performAdversaryAction(adversary, target, gameState) {
    simLog(` Spotlight is on: ${adversary.name} (targeting ${target.name} at (${target.position.x}, ${target.position.y}))...`);
    
    [cite_start]// Standard move is "Close" range [cite: 13914]
    moveAgentTowards(adversary, target, gameState, false); // false = not a sprint

    const allActions = adversary.features.filter(f => f.type === 'action' && f.parsed_effect);
    const affordableAndInRangeActions = allActions.filter(f => {
        if (f.cost) {
            if (f.cost.type === 'stress' && (adversary.current_stress + f.cost.value > adversary.max_stress)) return false; 
            if (f.cost.type === 'fear' && (gameState.fear < f.cost.value)) return false; 
        }
        const firstEffect = f.parsed_effect.actions[0];
        const range = (firstEffect && firstEffect.range) ? firstEffect.range : 'Melee';
        if (range.toLowerCase() === "self") return true; 
        if (!isTargetInRange(adversary, target, range)) {
            simLog(` (Skipping ${f.name}: Target is out of ${range} range.)`);
            return false; 
        }
        if (firstEffect.details) {
            if (firstEffect.details.target_condition && !target.conditions.includes(firstEffect.details.target_condition)) {
                simLog(` (Skipping ${f.name}: Target is not ${firstEffect.details.target_condition})`);
                return false;
            }
        }
        return true; 
    });
    let chosenAction = null;
    if (affordableAndInRangeActions.length > 0) {
        affordableAndInRangeActions.sort((a, b) => {
            let priorityA = 0, priorityB = 0;
            if (a.cost?.type === 'fear') priorityA = 3;
            else if (a.cost?.type === 'stress') priorityA = 2;
            else priorityA = 1;
            if (b.cost?.type === 'fear') priorityB = 3;
            else if (b.cost?.type === 'stress') priorityB = 2;
            else priorityB = 1;
            return priorityB - priorityA;
        });
        chosenAction = affordableAndInRangeActions[0];
    }

    if (chosenAction) {
        simLog(` -> Using Feature: ${chosenAction.name}!`);
        if (chosenAction.cost) {
            if (chosenAction.cost.type === 'stress') {
                adversary.current_stress += chosenAction.cost.value;
                simLog(` ${adversary.name} marks ${chosenAction.cost.value} Stress (Total: ${adversary.current_stress})`);
            } else if (chosenAction.cost.type === 'fear') {
                gameState.fear -= chosenAction.cost.value;
                simLog(` GM spends ${chosenAction.cost.value} Fear for the feature (Total: ${gameState.fear})`);
            }
        }
        for (const action of chosenAction.parsed_effect.actions) {
            executeParsedEffect(action, adversary, target, gameState);
        }
    } else {
        const weaponRange = adversary.attack.range || 'Melee';
        if (isTargetInRange(adversary, target, weaponRange)) {
            simLog(` -> No features in range. Defaulting to basic attack.`);
            executeGMBasicAttack(adversary, target, gameState);
        } else {
            [cite_start]// SRD: "An adversary can move within Close range for free as part of an action, or within Very Far range as a separate action." [cite: 13914, 13740]
            simLog(` -> Target is out of range for all actions. Sprinting closer.`);
            moveAgentTowards(adversary, target, gameState, true); // true = isSprint
        }
    }
}

// --- MODIFIED: Uses simLog ---
function executeParsedEffect(action, adversary, target, gameState) {
    let primaryTarget = target; 
    let targets = [target]; 
    if (action.target === "ALL_IN_RANGE" || action.target === "ALL_IN_RANGE_FRONT" || action.target === "ALL_AFFECTED") {
        const actionRange = action.range || 'Very Close';
        targets = gameState.players.filter(p => p.current_hp > 0 && isTargetInRange(adversary, p, actionRange));
        simLog(` -> Action targets ${targets.length} players in ${actionRange} range!`);
        if (targets.length === 0) {
            simLog(` -> No players in range. Action fails.`);
            return;
        }
        primaryTarget = targets[0];
    }
    switch (action.action_type) {
        case 'ATTACK_ROLL':
            if (action.details.cost) {
                if (action.details.cost.type === 'fear') {
                    if (gameState.fear >= action.details.cost.value) {
                        gameState.fear -= action.details.cost.value;
                        simLog(` -> GM spends ${action.details.cost.value} Fear for the action (Total: ${gameState.fear})`);
                    } else {
                        simLog(` -> GM cannot afford Fear cost for ${action.name}. Action fails.`);
                        return;
                    }
                }
            }
            let hitCount = 0; 
            for (const t of targets) {
                simLog(` Making an attack roll against ${t.name}...`);
                let damageBonus = 0;
                let takeSpotlight = false;
                const reactionResult = checkAdversaryReactions("BEFORE_DEALING_DAMAGE", adversary, t, gameState);
                if (reactionResult.damageBonus) damageBonus = reactionResult.damageBonus;
                if (reactionResult.takeSpotlight) takeSpotlight = true;
                const roll = rollD20();
                const modifier = adversary.attack.modifier || 0;
                const totalAttack = roll + modifier;
                simLog(` Roll: 1d20(${roll}) + ${modifier} = ${totalAttack} vs Evasion ${t.evasion}`);
                if (totalAttack >= t.evasion) {
                    simLog(' HIT!');
                    hitCount++; 
                    if (action.details.attack_type === 'standard') {
                        simLog(` -> This is a STANDARD attack type.`);
                        const damageString = adversary.attack.damage;
                        const damageTotal = rollDamage(damageString, 1, 0) + damageBonus;
                        const isDirect = adversary.passives.allAttacksAreDirect || false;
                        const damageInfo = { amount: damageTotal, isDirect, isPhysical: (adversary.attack.damage.includes('phy')), isStandardAttack: true };
                        applyDamage(damageInfo, adversary, t, gameState);
                        checkAdversaryReactions("ON_SUCCESSFUL_ATTACK", adversary, t, gameState, damageInfo);
                    }
                    if (action.details.on_success) {
                        for (const successAction of action.details.on_success) {
                            if (successAction.action_type === 'DEAL_DAMAGE' && damageBonus > 0) {
                                successAction.bonus = damageBonus;
                            }
                            executeParsedEffect(successAction, adversary, t, gameState);
                        }
                    }
                } else {
                    simLog(' MISS!');
                    if (action.details.on_fail) {
                        const onFailActions = Array.isArray(action.details.on_fail) ? action.details.on_fail : [action.details.on_fail];
                        for (const failAction of onFailActions) {
                            executeParsedEffect(failAction, adversary, t, gameState);
                        }
                    }
                }
                if (takeSpotlight) {
                    simLog(` -> ${adversary.name} takes the spotlight again! (Logic not implemented)`);
                }
            }
            if (action.details.on_success_multi_target && hitCount >= 2) {
                if (adversary.name === "Acid Burrower" && action.details.on_success[1]?.action_type === "FORCE_MARK_ARMOR_SLOT") {
                    simLog(` -> (Ignoring flawed JSON multi-target 'Fear' gain)`);
                } else {
                    simLog(` -> Hit ${hitCount} targets, triggering multi-target effect!`);
                    executeParsedEffect(action.details.on_success_multi_target, adversary, target, gameState);
                }
            }
            break;
        case 'FORCE_REACTION_ROLL':
            for (const t of targets) {
                const details = action.details;
                const difficulty = details.difficulty || 12; 
                simLog(` ${t.name} must make a ${details.roll_type.toUpperCase()} Reaction Roll (Diff ${difficulty})...`);
                const reactionSuccess = executeReactionRoll(t, details.roll_type, difficulty);
                if (reactionSuccess) {
                    simLog(` ${t.name} succeeds the Reaction Roll!`);
                    if (details.on_success) {
                        const onSuccessActions = Array.isArray(details.on_success) ? details.on_success : [details.on_success];
                        for (const successAction of onSuccessActions) {
                            executeParsedEffect(successAction, adversary, t, gameState);
                        }
                    }
                } else {
                    simLog(` ${t.name} fails the Reaction Roll!`);
                    if (details.on_fail) {
                        const onFailActions = Array.isArray(details.on_fail) ? details.on_fail : [details.on_fail];
                        for (const failAction of onFailActions) {
                            executeParsedEffect(failAction, adversary, t, gameState);
                        }
                    }
                }
            }
            break;
        case 'DEAL_DAMAGE':
            if (action.cost) {
                if (action.cost.type === 'fear' && gameState.fear >= action.cost.value) {
                    gameState.fear -= action.cost.value;
                    simLog(` -> GM spends ${action.cost.value} Fear for the effect (Total: ${gameState.fear})`);
                } else if (action.cost.type === 'fear') {
                    simLog(` -> GM cannot afford Fear cost for damage. Aborting effect.`);
                    return;
                }
            }
            let critBonus = 0; 
            let damageTotal;
            if (action.damage_string === 'half') {
                simLog(` (Logic Error: 'half' damage is not yet implemented. Dealing 1 damage.)`);
                damageTotal = 1; 
            } else if (action.damage_string.includes("stress") || action.damage_string.includes("HP")) {
                const parts = action.damage_string.split(' ');
                const value = parseInt(parts[0]) || 1;
                if (parts[1].toLowerCase() === 'stress') {
                    simLog(` Dealing ${value} DIRECT Stress!`);
                    target.current_stress = Math.min(target.max_stress, target.current_stress + value);
                    simLog(` ${target.name} Stress: ${target.current_stress} / ${target.max_stress}`);
                    return; 
                } else { 
                    damageTotal = value;
                }
            } else {
                damageTotal = rollDamage(action.damage_string, 1, critBonus);
            }
            if (action.bonus) {
                simLog(` -> Adding ${action.bonus} damage from Overload!`);
                damageTotal += action.bonus;
            }
            const isDirect = (action.is_direct && action.damage_string !== "1d10 phy" && action.damage_string !== "1d6 phy") || adversary.passives.allAttacksAreDirect || false;
            if (damageTotal > 0) {
                simLog(` Dealing ${damageTotal} ${isDirect ? 'DIRECT' : ''} damage!`);
                const damageInfo = { amount: damageTotal, isDirect, isPhysical: (action.damage_string.includes('phy')), isStandardAttack: false };
                applyDamage(damageInfo, adversary, primaryTarget, gameState); 
            } else {
                simLog(` Damage roll was 0, no damage dealt.`);
            }
            break;
        case 'DEAL_STRESS': 
            const stressVal = action.value || 0;
            if (stressVal > 0) {
                simLog(` Dealing ${stressVal} DIRECT Stress!`);
                target.current_stress = Math.min(target.max_stress, target.current_stress + stressVal);
                simLog(` ${target.name} Stress: ${target.current_stress} / ${target.max_stress}`);
            }
            break;
        case 'APPLY_CONDITION':
            if (action.cost) {
                if (action.cost.type === 'stress' && adversary.current_stress + action.cost.value <= adversary.max_stress) {
                    adversary.current_stress += action.cost.value;
                    simLog(` ${adversary.name} marks ${action.cost.value} Stress (Total: ${adversary.current_stress})`);
                    applyCondition(primaryTarget, action.condition);
                } else {
                    simLog(` ${adversary.name} could not afford Stress cost to apply ${action.condition}.`);
                }
            } else {
                applyCondition(primaryTarget, action.condition);
            }
            break;
        case 'MOVE':
            simLog(` -> ${adversary.name} is moving as part of an action...`);
            moveAgentTowards(adversary, primaryTarget, gameState);
            break;
        case 'FORCE_MARK_ARMOR_SLOT':
            if (primaryTarget.current_armor_slots > 0) {
                primaryTarget.current_armor_slots--;
                simLog(` -> ${primaryTarget.name} is forced to mark 1 Armor Slot! (Slots left: ${primaryTarget.current_armor_slots})`);
            } else {
                simLog(` -> ${primaryTarget.name} has no Armor Slots to mark!`);
                if (action.on_fail) {
                    simLog(` -> Triggering 'on_fail' logic for failing to mark armor...`);
                    if (adversary.name === "Acid Burrower") {
                        simLog(` -> ${primaryTarget.name} marks an additional HP!`);
                        const damageInfo = { amount: 1, isDirect: true, isPhysical: false, isStandardAttack: false };
                        applyDamage(damageInfo, adversary, primaryTarget, gameState);
                        simLog(` -> GM gains 1 Fear!`);
                        gameState.fear = Math.min(12, gameState.fear + 1);
                        simLog(` GM Fear: ${gameState.fear}`);
                    } else if (action.on_fail.actions && Array.isArray(action.on_fail.actions)) {
                        for (const failAction of action.on_fail.actions) {
                            executeParsedEffect(failAction, adversary, primaryTarget, gameState);
                        }
                    }
                }
            }
            break;
        case 'CREATE_HAZARD':
            simLog(` -> ${adversary.name} creates a Hazard in ${action.range} range!`);
            simLog(` -> ${action.details.hazard_effect}`);
            simLog(` -> (Simulation logic for Hazards not yet implemented.)`);
            break;
        case 'NARRATIVE_EFFECT':
            simLog(` -> ${adversary.name} uses ${action.details.description}`);
            simLog(` -> (This is a narrative effect, no mechanical change in sim.)`);
            break;
        case 'TAKE_SPOTLIGHT':
            simLog(` -> ${adversary.name} takes the spotlight! (Effect not fully implemented)`);
            break;
        case 'GAIN_FEAR':
            const fearValue = action.value || 1;
            simLog(` -> GM gains ${fearValue} Fear!`);
            gameState.fear = Math.min(12, gameState.fear + fearValue);
            simLog(` GM Fear: ${gameState.fear}`);
            break;
        case 'KNOCKBACK':
            const kbRange = action.range || 'Very Close';
            simLog(` -> ${primaryTarget.name} is knocked back to ${kbRange} range!`);
            if (primaryTarget.position.x < adversary.position.x) {
                primaryTarget.position.x = Math.max(1, primaryTarget.position.x - 2);
            } else {
                primaryTarget.position.x = Math.min(CURRENT_BATTLEFIELD.MAX_X, primaryTarget.position.x + 2);
            }
            simLog(` -> ${primaryTarget.name} lands at (${primaryTarget.position.x}, ${primaryTarget.position.y})`);
            break;
        case 'PULL':
            const pullRange = action.range || 'Melee';
            simLog(` -> ${primaryTarget.name} is pulled into ${pullRange} range!`);
            primaryTarget.position.x = Math.max(1, adversary.position.x - 1);
            primaryTarget.position.y = adversary.position.y;
            simLog(` -> ${primaryTarget.name} lands at (${primaryTarget.position.x}, ${primaryTarget.position.y})`);
            break;
        case 'MODIFY_DAMAGE':
            simLog(` -> (MODIFY_DAMAGE action noted, but logic is handled by reaction.)`);
            break;
        default:
            simLog(` (Logic for action_type '${action.action_type}' not yet implemented.)`);
    }
}

// --- MODIFIED: Uses simLog ---
function applyCondition(target, condition) {
    if (!target.conditions.includes(condition)) {
        target.conditions.push(condition);
        simLog(` ${target.name} is now ${condition}!`);
    }
}

// --- MODIFIED: Uses simLog ---
function executeGMBasicAttack(adversary, target, gameState) {
    let targets = [target];
    if (adversary.passives.attackAllInRange) {
        simLog(` -> ${adversary.name}'s 'Ramp Up' targets all players in range!`);
        const weaponRange = adversary.attack.range || 'Melee';
        targets = gameState.players.filter(p => p.current_hp > 0 && isTargetInRange(adversary, p, weaponRange));
    }
    for (const currentTarget of targets) {
        let damageBonus = 0;
        let takeSpotlight = false;
        const reactionResult = checkAdversaryReactions("BEFORE_DEALING_DAMAGE", adversary, currentTarget, gameState);
        if (reactionResult.damageBonus) damageBonus = reactionResult.damageBonus;
        if (reactionResult.takeSpotlight) takeSpotlight = true;
        const roll = rollD20();
        const modifier = adversary.attack.modifier || 0;
        const totalAttack = roll + modifier; 
        simLog(` Roll vs ${currentTarget.name}: 1d20(${roll}) + ${modifier} = ${totalAttack} vs Evasion ${currentTarget.evasion}`);
        if (totalAttack >= currentTarget.evasion) {
            simLog('  HIT!');
            let damageString = adversary.attack.damage;
            let critBonus = 0;
            if (roll === 20) { 
                simLog('  CRITICAL HIT!');
                critBonus = parseDiceString(damageString).maxDie;
            }
            const damageTotal = rollDamage(damageString, 1, critBonus) + damageBonus; 
            const isDirect = adversary.passives.allAttacksAreDirect || false;
            const damageInfo = { amount: damageTotal, isDirect, isPhysical: (adversary.attack.damage.includes('phy')), isStandardAttack: true };
            applyDamage(damageInfo, adversary, currentTarget, gameState); 
            checkAdversaryReactions("ON_SUCCESSFUL_ATTACK", adversary, currentTarget, gameState, damageInfo);
        } else {
            simLog('  MISS!');
        }
        if (takeSpotlight) {
            simLog(` -> ${adversary.name} takes the spotlight again! (Logic not implemented)`);
        }
    }
}

// --- CORE SIMULATION FUNCTIONS ---
function isCombatOver(gameState) {
    const playersAlive = gameState.players.some(p => p.current_hp > 0);
    const adversariesAlive = gameState.adversaries.some(a => a.current_hp > 0);
    if (!playersAlive) { 
        simLog('--- All players are defeated! ---'); 
        return true; 
    }
    if (!adversariesAlive) { 
        simLog('--- All adversaries are defeated! ---'); 
        return true; 
    }
    return false;
}

// --- MODIFIED: Uses simLog ---
function checkForPCDamageReactions(player, hpToMark, gameState) {
    if (player.class === "Guardian" && hpToMark === 3) { //
        const getBackUpCard = player.domainCards.find(c => c.name === "Get Back Up"); //
        if (getBackUpCard && player.current_stress < player.max_stress) { //
            player.current_stress++; //
            simLog(` -> ${player.name} uses "Get Back Up"!`); //
            simLog(` -> ${player.name} marks 1 Stress (Total: ${player.current_stress})`); //
            return true; //
        }
    }
    return false; //
}

// --- MODIFIED: Uses simLog ---
function checkAdversaryReactions(trigger, agent, target, gameState, damageInfo = {}) {
    if (!agent.features) return { damageBonus: 0, takeSpotlight: false }; //
    if (agent.current_hp <= 0 && trigger !== "ON_DEFEAT") return { damageBonus: 0, takeSpotlight: false };  //
    let reactionBonus = 0; //
    let reactionSpotlight = false; //
    for (const feature of agent.features) {
        if (feature.type !== 'reaction' || !feature.parsed_effect) continue; //
        for (const action of feature.parsed_effect.actions) { //
            if (action.trigger === trigger) { //
                if (trigger === "ON_TAKE_DAMAGE") { //
                    const hpThreshold = (action.trigger_details?.match(/(\d+)_HP_OR_MORE/) || [])[1]; //
                    if (hpThreshold && damageInfo.hpMarked < parseInt(hpThreshold)) { //
                        continue; //
                    }
                }
                if (action.cost) { //
                    if (action.cost.type === 'stress') { //
                        if (agent.current_stress < agent.max_stress) { //
                            agent.current_stress += action.cost.value; //
                            simLog(` -> ${agent.name} marks ${action.cost.value} Stress for ${feature.name} (Total: ${agent.current_stress})`); //
                        } else {
                            simLog(` -> ${agent.name} cannot afford Stress for ${feature.name}.`); //
                            continue; //
                        }
                    }
                }
                simLog(` -> ${agent.name}'s REACTION triggers: ${feature.name}!`); //
                if (trigger === "BEFORE_DEALING_DAMAGE") { //
                    if (action.action_type === 'MODIFY_DAMAGE') { //
                        reactionBonus += action.details.bonus || 0; //
                    }
                    if (action.action_type === 'TAKE_SPOTLIGHT') { //
                        reactionSpotlight = true; //
                    }
                } else {
                    executeParsedEffect(action, agent, target, gameState); //
                }
            }
        }
    }
    return { damageBonus: reactionBonus, takeSpotlight: reactionSpotlight }; //
}

// --- MODIFIED: Uses simLog ---
function processRollResources(result, gameState, player) {
    switch (result.outcome) {
        case 'CRITICAL_SUCCESS':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1); //
            player.current_stress = Math.max(0, player.current_stress - 1);  //
            simLog(` Resource: +1 Hope (Total: ${gameState.hope}), ${player.name} clears 1 Stress.`); //
            break;
        case 'SUCCESS_WITH_HOPE':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1); //
            simLog(` Resource: +1 Hope (Total: ${gameState.hope})`); //
            break;
        case 'FAILURE_WITH_HOPE':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1); //
            simLog(` Resource: +1 Hope (Total: ${gameState.hope})`); //
            break;
        case 'SUCCESS_WITH_FEAR':
            gameState.fear = Math.min(12, gameState.fear + 1); //
            simLog(` Resource: +1 Fear (Total: ${gameState.fear})`); //
            break;
        case 'FAILURE_WITH_FEAR':
            gameState.fear = Math.min(12, gameState.fear + 1); //
            simLog(` Resource: +1 Fear (Total: ${gameState.fear})`); //
            break;
    }
}

// --- MODIFIED: Uses simLog & Threshold Bug Fix ---
function applyDamage(damageInfo, attacker, target, gameState) {
    let finalTarget = target; //
    let isIntercepted = false; //
    let { amount, isDirect, isPhysical, isStandardAttack } = damageInfo; //
    if (gameState && target.type === 'player') {  //
        const interceptingPlayer = checkForPCReactions(amount, attacker, target, isDirect, gameState); //
        if (interceptingPlayer) { //
            finalTarget = interceptingPlayer;  //
            isIntercepted = true; //
        }
    }
    let hpToMark = 0; //
    let isMajor = false; //
    let isSevere = false; //
    
    // --- BUG FIX: Check if thresholds object and properties exist ---
    const majorThreshold = finalTarget.thresholds?.major; //
    const severeThreshold = finalTarget.thresholds?.severe; //

    if (!majorThreshold || !severeThreshold) {
        simLog(` (WARNING: Target ${finalTarget.name} has N/A thresholds! Defaulting to 1 HP.)`); //
        if (amount > 0) hpToMark = 1;  //
    } else {
        if (amount >= severeThreshold) { //
            hpToMark = 3; //
            isSevere = true; //
            isMajor = true; //
        } else if (amount >= majorThreshold) { //
            hpToMark = 2; //
            isMajor = true; //
        } else if (amount > 0) { //
            hpToMark = 1; //
        }
    }
    
    if (finalTarget.type === 'adversary' && finalTarget.passives.takeExtraPhysicalHP && isPhysical && hpToMark > 0) { //
        simLog(` -> ${finalTarget.name}'s 'Weak Structure' passive applies!`); //
        hpToMark += finalTarget.passives.takeExtraPhysicalHP; //
    }
    let originalHPMark = hpToMark; //
    simLog(` Damage: ${amount} (dealt by ${attacker.name}) vs ${finalTarget.name}'s Thresholds (${majorThreshold || 'N/A'}/${severeThreshold || 'N/A'})`); //
    simLog(` Calculated Severity: ${originalHPMark} HP`); //
    
    if (finalTarget.type === 'player' && hpToMark > 0) { //
        const severityReduced = checkForPCDamageReactions(finalTarget, hpToMark, gameState); //
        if (severityReduced) { //
            hpToMark--; //
            simLog(` -> Severity reduced by reaction! New HP to mark: ${hpToMark}`); //
            if (originalHPMark === 3) isSevere = false; //
            if (originalHPMark === 2 && hpToMark < 2) isMajor = false; //
        }
    }
    if (isIntercepted && finalTarget.class === "Guardian") { //
        simLog(` -> Guardian "I Am Your Shield" applies!`); //
        while (hpToMark > 0 && finalTarget.current_armor_slots > 0) { //
            finalTarget.current_armor_slots--; //
            hpToMark--; //
            simLog(` ${finalTarget.name} marks 1 Armor Slot! (Slots left: ${finalTarget.current_armor_slots})`); //
        }
    } 
    else if (finalTarget.type === 'player' && finalTarget.current_armor_slots > 0 && hpToMark > 0 && !isDirect) { //
        finalTarget.current_armor_slots--; //
        hpToMark--; //
        simLog(` ${finalTarget.name} marks 1 Armor Slot! (Slots left: ${finalTarget.current_armor_slots})`); //
    } else if (isDirect && finalTarget.type === 'player') { //
        simLog(` This is DIRECT damage and cannot be mitigated by armor!`); //
    }
    finalTarget.current_hp -= hpToMark; //
    if (originalHPMark > hpToMark) { //
        simLog(` Final HP marked: ${hpToMark}.`); //
    } else if (originalHPMark > 0) { //
        simLog(` Final HP marked: ${hpToMark}.`); //
    }
    simLog(` ${finalTarget.name} HP: ${finalTarget.current_hp} / ${finalTarget.max_hp}`); //
    const damageEventInfo = {
        amount: amount,
        hpMarked: hpToMark,
        isMajor: isMajor,
        isSevere: isSevere,
        isPhysical: isPhysical,
        isStandardAttack: isStandardAttack //
    };
    if (finalTarget.type === 'adversary') { //
        checkAdversaryReactions("ON_TAKE_DAMAGE", finalTarget, attacker, gameState, damageEventInfo); //
        if (damageEventInfo.isSevere) { //
            checkAdversaryReactions("ON_TAKE_SEVERE_DAMAGE", finalTarget, attacker, gameState, damageEventInfo); //
        }
    }
    if (attacker.type === 'adversary' && hpToMark > 0) { //
        checkAdversaryReactions("ON_DEAL_HP", attacker, finalTarget, gameState, damageEventInfo); //
    }
    if (attacker.type === 'adversary' && hpToMark > 0) { //
        if (damageInfo.isStandardAttack && attacker.passives.knockbackOnHP) { //
             simLog(` -> ${attacker.name}'s PASSIVE triggers: Overwhelming Force!`); //
             const knockbackEffect = { action_type: 'KNOCKBACK', range: attacker.passives.knockbackOnHP.range, is_direct: false }; [cite_start]// [cite: 14732-14737]
             executeParsedEffect(knockbackEffect, attacker, finalTarget, gameState); //
        }
    }
    if (finalTarget.current_hp <= 0) { //
        simLog(` *** ${finalTarget.name} has been defeated! ***`); //
        if (finalTarget.type === 'adversary') { //
            checkAdversaryReactions("ON_DEFEAT", finalTarget, attacker, gameState, damageEventInfo); //
        }
    }
}

// --- MODIFIED: Uses simLog ---
function checkForPCReactions(damageTotal, attacker, target, isDirectDamage, gameState) {
    for (const potentialProtector of gameState.players) { //
        if (potentialProtector.current_hp <= 0 || potentialProtector.id === target.id) { //
            continue; //
        }
        if (potentialProtector.class === "Guardian") { //
            const shieldCard = potentialProtector.domainCards.find(c => c.name === "I Am Your Shield"); //
            if (shieldCard) { //
                if (potentialProtector.current_stress < potentialProtector.max_stress) { //
                    if (isTargetInRange(potentialProtector, target, "Very Close")) { //
                        potentialProtector.current_stress += 1;  //
                        simLog(` -> ${potentialProtector.name} uses "I Am Your Shield"!`); //
                        simLog(` -> ${potentialProtector.name} marks 1 Stress (Total: ${potentialProtector.current_stress})`); //
                        return potentialProtector;  //
                    }
                }
            }
        }
    }
    return null; //
}

// --- CORE DICE & PARSING UTILITIES (MODIFIED: Use simLog) ---
function rollD20() { return Math.floor(Math.random() * 20) + 1; } //
function rollD12() { return Math.floor(Math.random() * 12) + 1; } //
function executeReactionRoll(target, trait, difficulty) {
    const roll = rollD20(); //
    const traitMod = target.traits[trait.toLowerCase()] || 0; //
    const total = roll + traitMod; //
    simLog(` ${target.name} makes a ${trait.toUpperCase()} Reaction Roll (Diff ${difficulty})`); //
    simLog(` Roll: 1d20(${roll}) + ${trait}(${traitMod}) = ${total}`); //
    return total >= difficulty; //
}
function executeActionRoll(difficulty, traitModifier, otherModifiers) {
    const hopeRoll = rollD12(); //
    const fearRoll = rollD12(); //
    const safeTraitModifier = typeof traitModifier === 'number' ? traitModifier : 0; //
    const safeOtherModifiers = typeof otherModifiers === 'number' ? otherModifiers : 0; //
    const baseSum = hopeRoll + fearRoll; //
    const total = baseSum + safeTraitModifier + safeOtherModifiers; //
    let outcome = '';
    if (hopeRoll === fearRoll) { outcome = 'CRITICAL_SUCCESS'; }  //
    else if (total >= difficulty) { outcome = (hopeRoll > fearRoll) ? 'SUCCESS_WITH_HOPE' : 'SUCCESS_WITH_FEAR'; }  //
    else { outcome = (hopeRoll > fearRoll) ? 'FAILURE_WITH_HOPE' : 'FAILURE_WITH_FEAR'; } //
    return { hopeRoll, fearRoll, total, difficulty, outcome }; //
}
function rollDamage(damageString, proficiency, critBonus = 0) {
    const { numDice, dieType, modifier, maxDie } = parseDiceString(damageString); //
    let totalDamage = 0; //
    let diceToRoll = (proficiency > 1) ? (numDice * proficiency) : numDice; //
    if (dieType > 0) { //
        for (let i = 0; i < diceToRoll; i++) { //
            totalDamage += Math.floor(Math.random() * dieType) + 1; //
        }
    }
    totalDamage += modifier; //
    totalDamage += critBonus;  //
    return totalDamage; //
}
function parseDiceString(damageString = "1d4") {
    if (typeof damageString !== 'string') { //
        simLog(`(ERROR: Invalid damage string: ${damageString})`); //
        return { numDice: 0, dieType: 0, modifier: 0, maxDie: 0 }; //
    }
    damageString = damageString.split(' ')[0]; //
    let numDice = 1, dieType = 4, modifier = 0; //
    const modSplit = damageString.split('+'); //
    if (modSplit.length > 1) modifier = parseInt(modSplit[1]) || 0; //
    const dicePart = modSplit[0]; //
    const dieSplit = dicePart.split('d'); //
    if (dieSplit[0] === '') {  //
        numDice = 1; //
        dieType = parseInt(dieSplit[1]) || 4; //
    } else if (dieSplit.length > 1) {  //
        numDice = parseInt(dieSplit[0]) || 1; //
        dieType = parseInt(dieSplit[1]) || 4; //
    } else if (!damageString.includes('d')) {  //
        numDice = 0; dieType = 0; //
        modifier = parseInt(dieSplit[0]) || 0; //
    }
    return { numDice, dieType, modifier, maxDie: dieType }; //
}

// --- MOVEMENT & RANGE HELPER FUNCTIONS (MODIFIED: Use simLog) ---
function isCellOccupied(x, y, gameState, selfId) {
    const allAgents = [...gameState.players, ...gameState.adversaries]; //
    for (const agent of allAgents) { //
        if (agent.id === selfId || agent.current_hp <= 0) { //
            continue;  //
        }
        if (agent.position.x === x && agent.position.y === y) { //
            return true; //
        }
    }
    return false; //
}
function getAgentDistance(agentA, agentB) {
    if (!agentA.position || !agentB.position) return 0; //
    const dx = Math.abs(agentA.position.x - agentB.position.x); //
    const dy = Math.abs(agentA.position.y - agentB.position.y); //
    return dx + dy; //
}
function isTargetInRange(attacker, target, weaponRangeName) {
    const distance = getAgentDistance(attacker, target); //
    const range = (weaponRangeName || 'Melee').trim().toLowerCase(); //
    switch (range) { //
        case 'self': return true; //
        case 'melee': return distance <= CURRENT_BATTLEFIELD.RANGE_MELEE; //
        case 'very close': return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_CLOSE; //
        case 'close': return distance <= CURRENT_BATTLEFIELD.RANGE_CLOSE; //
        case 'far': return distance <= CURRENT_BATTLEFIELD.RANGE_FAR; //
        case 'very far': return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_FAR;
        default:
            simLog(`(Warning: Unknown range name '${weaponRangeName}')`); //
            return false; //
    }
}
// --- MODIFIED: Added 'isSprint' flag ---
function moveAgentTowards(agent, target, gameState, isSprint = false) {
    [cite_start]// SRD: "a character can move to a location within Close range as part of that action." [cite: 13912]
    [cite_start]// SRD: "An adversary can move within Close range for free as part of an action, or within Very Far range as a separate action." [cite: 13914]
    let budget;
    if (agent.type === 'player') {
        budget = isSprint ? DAGGERHEART_RANGES.RANGE_FAR : DAGGERHEART_RANGES.RANGE_CLOSE; //
    } else { // Adversary
        budget = isSprint ? DAGGERHEART_RANGES.RANGE_VERY_FAR : DAGGERHEART_RANGES.RANGE_CLOSE; //
    }
    
    let currentX = agent.position.x; //
    let currentY = agent.position.y; //
    let moved = false; //
    while (budget > 0) { //
        let movedThisStep = false; //
        const dx = target.position.x - currentX; //
        const dy = target.position.y - currentY; //
        if (getAgentDistance({position: {x: currentX, y: currentY}}, target) <= 1) { //
            break; //
        }
        if (Math.abs(dx) > Math.abs(dy)) { //
            let nextX = currentX + Math.sign(dx); //
            if (!isCellOccupied(nextX, currentY, gameState, agent.id)) { //
                currentX = nextX; //
                movedThisStep = true; //
            }
        } else {
            let nextY = currentY + Math.sign(dy); //
            if (!isCellOccupied(currentX, nextY, gameState, agent.id)) { //
                currentY = nextY; //
                movedThisStep = true; //
            }
        }
        if (!movedThisStep) { //
            if (Math.abs(dx) > Math.abs(dy)) {  //
                let nextY = currentY + Math.sign(dy); //
                if (dy !== 0 && !isCellOccupied(currentX, nextY, gameState, agent.id)) { //
                    currentY = nextY; //
                    movedThisStep = true; //
                }
            } else { 
                let nextX = currentX + Math.sign(dx); //
                if (dx !== 0 && !isCellOccupied(nextX, currentY, gameState, agent.id)) { //
                    currentX = nextX; //
                    movedThisStep = true; //
                }
            }
        }
        if (!movedThisStep) { //
            simLog(` -> ${agent.name} is blocked and cannot move further.`); //
            break; //
        }
        budget--; //
        moved = true; //
    }
    if (moved) { //
        agent.position.x = currentX; //
        agent.position.y = currentY; //
        simLog(` -> ${agent.name} moves to (${currentX}, ${currentY})`); //
    }
}
// --- END OF HELPER FUNCTIONS ---

// --- *** NEW LOGGING SYSTEM *** ---
// simLog(message) captures text *during* a simulation run
function simLog(message) {
    BATCH_LOG.push(message);
}
// printToLog(message, className) prints text to the *actual* UI
function printToLog(message, className = null) {
    const logOutput = document.getElementById('log-output');
    if (logOutput) {
        const el = document.createElement('div');
        if (className) {
            el.className = className;
        }
        // Use innerText to preserve whitespace for scoreboard
        el.innerText = message; 
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