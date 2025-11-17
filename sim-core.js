// --- GLOBAL STATE ---
let playerPool = [];
let adversaryPool = [];
let environmentPool = []; // NEW
let activeParty = [];
let activeAdversaries = [];
let activeEnvironment = null; // NEW: Singular active environment
let survivorPool = []; // NEW: Store players who survive a sim
let SRD_ADVERSARIES = [];
let PREMADE_CHARACTERS = [];
let PLACEHOLDER_ENVIRONMENTS = []; // NEW
let BATCH_LOG = []; // Global log capture
let tokenCache = {}; 
let simHistory = [];

// --- BP MODIFIER STATE ---
const BP_MODIFIER_LIBRARY = [
    { id: 'easier', name: '-1 for easier fight', bpValue: -1 },
    { id: 'two_plus_solos', name: '-2 for 2+ Solo adversaries', bpValue: -2 },
    { id: 'add_d4_damage', name: '-2 to add +1d4 damage', bpValue: -2, type: 'ADD_D4_DAMAGE' },
    { id: 'lower_tier_adv', name: '+1 for lower tier adversaries', bpValue: 1 },
    { id: 'no_heavy_hitters', name: '+1 for no Bruisers/Hordes/Leaders/Solos', bpValue: 1 },
    { id: 'harder', name: '+2 for harder fight', bpValue: 2 }
    ];
    let activeBpModifiers = []; // Modifiers added to the active scene

// --- BATTLEFIELD & RANGE CONFIGS ---
const DAGGERHEART_RANGES = {
    RANGE_MELEE: 1,
    RANGE_VERY_CLOSE: 3,
    RANGE_CLOSE: 6,
    RANGE_FAR: 12,
    RANGE_VERY_FAR: 24 // Added Very Far for rules completeness
};

// --- Map Size Configuration ---
const MAP_CONFIGS = {
    small: { MAX_X: 15, MAX_Y: 15 },
    medium: { MAX_X: 20, MAX_Y: 20 },
    large: { MAX_X: 30, MAX_Y: 30 }
};


// --- PARSING & INSTANTIATION FUNCTIONS ---
function instantiatePlayerAgent(data) {

    // NEW: Check if the agent is already a survivor instance
    if(data.type === 'player') {
        simLog(`(Re-using survivor agent: ${data.name} with ${data.current_hp} HP)`);
        simLog(` -> Survivor ${data.name} carrying over ${data.current_hope} Hope.`);
        simLog(` -> Survivor ${data.name} conditions cleared.`);
        data.conditions = []; // Clear temporary conditions for the new fight

        // Re-randomize position for the new battle
        data.position = {
            x: Math.floor(Math.random() * 3) + 1,
            y: Math.floor(Math.random() * CURRENT_BATTLEFIELD.MAX_Y) + 1
        };
        return data;
    }
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
        level: data.level,
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
        speed: DAGGERHEART_RANGES.RANGE_CLOSE,

        // NEW: Properties for persistent state
        abilityUsage: {},
        prayerDice: [],
        slayerDice: [] 
    };

    // Roll Prayer Dice for Seraphs
    if (agent.class === 'Seraph') {
        const spellcastTraitMod = agent.traits[agent.spellcastTrait] || 0;
        if (spellcastTraitMod > 0) {
            simLog(` (Rolling ${spellcastTraitMod} Prayer Dice for Seraph)`);
            for (let i = 0; i < spellcastTraitMod; i++) {
                agent.prayerDice.push(Math.floor(Math.random() * 4) + 1);
            }
        }
    }

    return agent;
}

function instantiateAdversaryAgent(data) {

    // NEW: Check if agent is already an instance
    if (data.type === 'adversary') {
        simLog(` (Re-using adversary agent: ${data.name} with ${data.current_hp} HP)`);

        // Re-randomize position for the new battle
        data.position = {
            x: CURRENT_BATTLEFIELD.MAX_X - Math.floor(Math.random() * 3),
            y: Math.floor(Math.random() * CURRENT_BATTLEFIELD.MAX_Y) + 1
        };
        return data;
    }

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
        // --- BUG FIX: Create the thresholds object ---
        thresholds: {
            major: data.major,
            severe: data.severe
        },
        // --- END BUG FIX ---
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

// --- CORE DICE & PARSING UTILITIES ---
function rollD20() { return Math.floor(Math.random() * 20) + 1; }
function rollD12() { return Math.floor(Math.random() * 12) + 1; }

function executeReactionRoll(target, trait, difficulty) {
    const roll = rollD20();
    const traitMod = target.traits[trait.toLowerCase()] || 0;
    const total = roll + traitMod;
    simLog(` ${target.name} makes a ${trait.toUpperCase()} Reaction Roll (Diff ${difficulty})`);
    simLog(` Roll: 1d20(${roll}) + ${trait}(${traitMod}) = ${total}`);
    return total >= difficulty;
}

function executeActionRoll(difficulty, traitModifier, otherModifiers) {
    const hopeRoll = rollD12();
    const fearRoll = rollD12();
    const safeTraitModifier = typeof traitModifier === 'number' ? traitModifier : 0;
    const safeOtherModifiers = typeof otherModifiers === 'number' ? otherModifiers : 0;
    const baseSum = hopeRoll + fearRoll;
    const total = baseSum + safeTraitModifier + safeOtherModifiers;
    let outcome = '';

    if (hopeRoll === fearRoll) { outcome = 'CRITICAL_SUCCESS'; } 
    else if (total >= difficulty) { outcome = (hopeRoll > fearRoll) ? 'SUCCESS_WITH_HOPE' : 'SUCCESS_WITH_FEAR'; } 
    else { outcome = (hopeRoll > fearRoll) ? 'FAILURE_WITH_HOPE' : 'FAILURE_WITH_FEAR'; }
    
    return {
        hopeRoll, fearRoll, total, difficulty, outcome
    };
}

function rollDamage(damageString, proficiency, critBonus = 0) {
    const { numDice, dieType, modifier, maxDie } = parseDiceString(damageString);
    let totalDamage = 0;
    
    let diceToRoll = (proficiency > 1) ? (numDice * proficiency) : numDice;
    
    if (dieType > 0) {
        for (let i = 0; i < diceToRoll; i++) {
            totalDamage += Math.floor(Math.random() * dieType) + 1;
        }
    }
    
    totalDamage += modifier;
    totalDamage += critBonus; 
    
    return totalDamage;
}

function parseDiceString(damageString = "1d4") {
    if (typeof damageString !== 'string') {
        simLog(`(ERROR: Invalid damage string: ${damageString})`);
        return { numDice: 0, dieType: 0, modifier: 0, maxDie: 0 };
    }
    damageString = damageString.split(' ')[0]; 
    let numDice = 1, dieType = 4, modifier = 0;
    
    const modSplit = damageString.split('+');
    if (modSplit.length > 1) modifier = parseInt(modSplit[1]) || 0;
    
    const dicePart = modSplit[0];
    const dieSplit = dicePart.split('d');
    
    if (dieSplit[0] === '') { 
        numDice = 1;
        dieType = parseInt(dieSplit[1]) || 4;
    } else if (dieSplit.length > 1) { 
        numDice = parseInt(dieSplit[0]) || 1;
        dieType = parseInt(dieSplit[1]) || 4;
    } else if (!damageString.includes('d')) { 
        numDice = 0; dieType = 0;
        modifier = parseInt(dieSplit[0]) || 0;
    }
    
    return { numDice, dieType, modifier, maxDie: dieType };
}

// --- MOVEMENT & RANGE HELPER FUNCTIONS ---

function isCellOccupied(x, y, gameState, selfId) {
    const allAgents = [...gameState.players, ...gameState.adversaries];
    for (const agent of allAgents) {
        if (agent.id === selfId || agent.current_hp <= 0) {
            continue; 
        }
        if (agent.position.x === x && agent.position.y === y) {
            return true; 
        }
    }
    return false;
}

function getAgentDistance(agentA, agentB) {
    if (!agentA.position || !agentB.position) return 0;
    const dx = Math.abs(agentA.position.x - agentB.position.x);
    const dy = Math.abs(agentA.position.y - agentB.position.y);
    return dx + dy;
}

function isTargetInRange(attacker, target, weaponRangeName) {
    const distance = getAgentDistance(attacker, target);
    const range = (weaponRangeName || 'Melee').trim().toLowerCase();

    switch (range) {
        case 'self':
            return true;
        case 'melee':
            return distance <= CURRENT_BATTLEFIELD.RANGE_MELEE;
        case 'very close':
            return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_CLOSE;
        case 'close':
            return distance <= CURRENT_BATTLEFIELD.RANGE_CLOSE;
        case 'far':
            return distance <= CURRENT_BATTLEFIELD.RANGE_FAR;
        case 'very far':
             return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_FAR;
        default:
            simLog(`(Warning: Unknown range name '${weaponRangeName}')`);
            return false;
    }
}

// --- MOVEMENT & RANGE HELPER FUNCTIONS ---

function isCellOccupied(x, y, gameState, selfId) {
    const allAgents = [...gameState.players, ...gameState.adversaries];
    for (const agent of allAgents) {
        if (agent.id === selfId || agent.current_hp <= 0) {
            continue; 
        }
        if (agent.position.x === x && agent.position.y === y) {
            return true; 
        }
    }
    return false;
}

function getAgentDistance(agentA, agentB) {
    if (!agentA.position || !agentB.position) return 0;
    const dx = Math.abs(agentA.position.x - agentB.position.x);
    const dy = Math.abs(agentA.position.y - agentB.position.y);
    return dx + dy;
}

function isTargetInRange(attacker, target, weaponRangeName) {
    const distance = getAgentDistance(attacker, target);
    const range = (weaponRangeName || 'Melee').trim().toLowerCase();

    switch (range) {
        case 'self':
            return true;
        case 'melee':
            return distance <= CURRENT_BATTLEFIELD.RANGE_MELEE;
        case 'very close':
            return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_CLOSE;
        case 'close':
            return distance <= CURRENT_BATTLEFIELD.RANGE_CLOSE;
        case 'far':
            return distance <= CURRENT_BATTLEFIELD.RANGE_FAR;
        case 'very far':
             return distance <= CURRENT_BATTLEFIELD.RANGE_VERY_FAR;
        default:
            simLog(`(Warning: Unknown range name '${weaponRangeName}')`);
            return false;
    }
}

// --- MODIFIED: Added 'isSprint' flag ---
function moveAgentTowards(agent, target, gameState, isSprint = false) {
    // Sprints are a full Far range move, otherwise use agent's speed (Close)
    let budget = isSprint ? DAGGERHEART_RANGES.RANGE_FAR : agent.speed; 
    
    let currentX = agent.position.x;
    let currentY = agent.position.y;
    let moved = false;

    while (budget > 0) {
        let movedThisStep = false;
        const dx = target.position.x - currentX;
        const dy = target.position.y - currentY;

        if (getAgentDistance({position: {x: currentX, y: currentY}}, target) <= 1) {
            break; // Already in Melee
        }

        if (Math.abs(dx) > Math.abs(dy)) {
            let nextX = currentX + Math.sign(dx);
            if (!isCellOccupied(nextX, currentY, gameState, agent.id)) {
                currentX = nextX;
                movedThisStep = true;
            }
        } else {
            let nextY = currentY + Math.sign(dy);
            if (!isCellOccupied(currentX, nextY, gameState, agent.id)) {
                currentY = nextY;
                movedThisStep = true;
            }
        }

        if (!movedThisStep) { // Try diagonal/secondary axis if blocked
            if (Math.abs(dx) > Math.abs(dy)) { 
                let nextY = currentY + Math.sign(dy);
                if (dy !== 0 && !isCellOccupied(currentX, nextY, gameState, agent.id)) {
                    currentY = nextY;
                    movedThisStep = true;
                }
            } else { 
                let nextX = currentX + Math.sign(dx);
                if (dx !== 0 && !isCellOccupied(nextX, currentY, gameState, agent.id)) {
                    currentX = nextX;
                    movedThisStep = true;
                }
            }
        }

        if (!movedThisStep) {
            simLog(` -> ${agent.name} is blocked and cannot move further.`);
            break;
        }

        budget--;
        moved = true;
    }

    if (moved) {
        agent.position.x = currentX;
        agent.position.y = currentY;
        simLog(` -> ${agent.name} moves to (${currentX}, ${currentY})`);
    }
}
// --- END OF HELPER FUNCTIONS ---
