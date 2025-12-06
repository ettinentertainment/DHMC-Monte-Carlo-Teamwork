// --- GLOBAL STATE ---
window.playerPool = [];
window.adversaryPool = [];
window.environmentPool = []; 
window.survivorPool = []; 
let activeParty = [];
let activeAdversaries = [];
let activeEnvironment = null; 
let SRD_ADVERSARIES = [];
let PREMADE_CHARACTERS = [];
let PLACEHOLDER_ENVIRONMENTS = []; 
let BATCH_LOG = []; 
let tokenCache = {}; 
let simHistory = [];
let activeBpModifiers = []; 

// --- CONFIGURATION CONSTANTS (Global for access) ---
const BP_MODIFIER_LIBRARY = [
    { id: 'easier', name: '-1 for easier fight', bpValue: -1 },
    { id: 'two_plus_solos', name: '-2 for 2+ Solo adversaries', bpValue: -2 },
    { id: 'add_d4_damage', name: '-2 to add +1d4 damage', bpValue: -2, type: 'ADD_D4_DAMAGE' },
    { id: 'lower_tier_adv', name: '+1 for lower tier adversaries', bpValue: 1 },
    { id: 'no_heavy_hitters', name: '+1 for no Bruisers/Hordes/Leaders/Solos', bpValue: 1 },
    { id: 'harder', name: '+2 for harder fight', bpValue: 2 }
];

const DAGGERHEART_RANGES = {
    RANGE_MELEE: 1,
    RANGE_VERY_CLOSE: 3,
    RANGE_CLOSE: 6,
    RANGE_FAR: 12,
    RANGE_VERY_FAR: 24 
};

const MAP_CONFIGS = {
    small: { MAX_X: 15, MAX_Y: 15 },
    medium: { MAX_X: 20, MAX_Y: 20 },
    large: { MAX_X: 30, MAX_Y: 30 }
};

// --- INITIALIZATION FUNCTION ---
function initSimCore() {
    console.log('Math Check (Expect ~7-19):', rollDamage('1d8+1d4+2', 1));

    // Expose functions to window if needed for external access overrides
    if (typeof window !== 'undefined') {
        window.getAdversaryBpCost = getAdversaryBpCost;
    }
}

// --- PARSING & INSTANTIATION FUNCTIONS ---
function instantiatePlayerAgent(schema) {
    if (schema.is_hydrated) {
        return JSON.parse(JSON.stringify(schema));
    }
    return hydratePlayerAgent(schema);
}

function hydratePlayerAgent(schema) {
    const agent = JSON.parse(JSON.stringify(schema));
    
    agent.id = agent.id || `player-${Date.now()}-${Math.random()}`;
    agent.simId = agent.id;
    agent.name = schema.name || "Unnamed Hero";
    agent.class = agent.class_key;
    agent.position = agent.current_state?.position || { x: 1, y: 1 };
    
    agent.features = [];
    agent.domainCards = [];
    agent.actions = [];
    agent.passives = [];
    agent.conditions = agent.current_state?.active_conditions || [];
    agent.abilityUsage = {};

    // --- 1. Hydrate Class & Features ---
    if (typeof CLASS_FEATURES !== 'undefined' && CLASS_FEATURES[agent.class_key]) {
        const cls = CLASS_FEATURES[agent.class_key];
        
        if (cls.spellcast_trait) {
            agent.spellcastTrait = cls.spellcast_trait;
        }

        if (cls.features) agent.features.push(...JSON.parse(JSON.stringify(cls.features)));
        
        if (cls.hope_feature) {
            const hopeFeat = JSON.parse(JSON.stringify(cls.hope_feature));
            hopeFeat.tags = [...(hopeFeat.tags || []), "Hope Feature"];
            agent.features.push(hopeFeat);
        }

        if (agent.subclass_key && cls.subclasses?.[agent.subclass_key]) {
            agent.features.push(...JSON.parse(JSON.stringify(cls.subclasses[agent.subclass_key])));
        }
    }

    // Ancestry
    if (typeof ANCESTRY_LIBRARY !== 'undefined' && ANCESTRY_LIBRARY[agent.ancestry_key]) {
        agent.features.push(...JSON.parse(JSON.stringify(ANCESTRY_LIBRARY[agent.ancestry_key].features)));
    }
    // Community
    if (typeof COMMUNITY_LIBRARY !== 'undefined' && COMMUNITY_LIBRARY[agent.community_key]) {
        agent.features.push(...JSON.parse(JSON.stringify(COMMUNITY_LIBRARY[agent.community_key].features)));
    }

    // --- 2. Hydrate Domain Cards ---
    if (typeof DOMAIN_CARD_LIBRARY !== 'undefined') {
        agent.domainCards = (agent.active_loadout.domain_card_keys || [])
            .map(key => {
                const card = DOMAIN_CARD_LIBRARY[key];
                return card ? JSON.parse(JSON.stringify(card)) : null;
            })
            .filter(card => card !== null);
    }

    // --- 3. Derived Stats & Proficiency ---
    let tier = 1;
    if (agent.level >= 8) tier = 4;
    else if (agent.level >= 5) tier = 3;
    else if (agent.level >= 2) tier = 2;
    
    agent.proficiency = tier;

    // --- 4. Armor ---
    const hasBareBones = agent.domainCards.some(c => c.name === "Bare Bones");
    
    let armorData = null;
    if (typeof ARMOR_LIBRARY !== 'undefined' && agent.active_loadout.armor_key) {
        armorData = JSON.parse(JSON.stringify(ARMOR_LIBRARY[agent.active_loadout.armor_key]));
    }

    if (hasBareBones) {
        const str = agent.traits.strength || 0;
        agent.armor_score = 3 + str;
        const bbThresholds = [{ major: 9, severe: 19 }, { major: 11, severe: 24 }, { major: 13, severe: 31 }, { major: 15, severe: 38 }];
        const tVals = bbThresholds[Math.min(tier - 1, 3)];
        agent.thresholds = { minor: 1, major: tVals.major + agent.level, severe: tVals.severe + agent.level };
        
        armorData = null; 
    } else if (armorData) {
        agent.armor_score = armorData.stats?.armorScore || armorData.base_score || 0;
        const baseMajor = (armorData.stats?.thresholds?.major || armorData.base_thresholds?.major || 0);
        const baseSevere = (armorData.stats?.thresholds?.severe || armorData.base_thresholds?.severe || 0);
        agent.thresholds = { 
            minor: 1, 
            major: baseMajor + agent.level, 
            severe: baseSevere + agent.level 
        };
    } else {
        agent.armor_score = 0;
        agent.thresholds = { minor: 1, major: agent.level, severe: agent.level * 2 };
    }

    // --- 5. Weapons ---
    if (agent.active_loadout && agent.active_loadout.primary_weapon_key) {
        agent.primary_weapon = agent.active_loadout.primary_weapon_key;
    }

    if (typeof agent.primary_weapon === 'string') {
         const id = agent.primary_weapon;
         let weaponObj = null;
         
         if (typeof WEAPON_LIBRARY !== 'undefined') {
             if (WEAPON_LIBRARY[id]) {
                 weaponObj = JSON.parse(JSON.stringify(WEAPON_LIBRARY[id]));
             } 
             else {
                 weaponObj = Object.values(WEAPON_LIBRARY).find(w => w.id === id);
                 if (weaponObj) weaponObj = JSON.parse(JSON.stringify(weaponObj));
             }
         }

         if (weaponObj) {
             agent.primary_weapon = weaponObj;
         } else {
             console.error(`CRITICAL: Weapon ID [${id}] not found in library.`);
         }
    }

    if (typeof agent.primary_weapon !== 'object' || !agent.primary_weapon) {
        agent.primary_weapon = { 
            id: "Unarmed", 
            name: "Unarmed", 
            tags: ["Melee"], 
            stats: { baseDice: "1d4", damageType: "Physical", statToRoll: "strength" } 
        };
    }

    if (agent.active_loadout && agent.active_loadout.secondary_weapon_key) {
        agent.secondary_weapon = agent.active_loadout.secondary_weapon_key;
    }
    
    if (typeof agent.secondary_weapon === 'string') {
         const id = agent.secondary_weapon;
         let weaponObj = null;
         if (typeof WEAPON_LIBRARY !== 'undefined') {
             if (WEAPON_LIBRARY[id]) {
                 weaponObj = JSON.parse(JSON.stringify(WEAPON_LIBRARY[id]));
             } else {
                 weaponObj = Object.values(WEAPON_LIBRARY).find(w => w.id === id);
                 if (weaponObj) weaponObj = JSON.parse(JSON.stringify(weaponObj));
             }
         }
         if (weaponObj) agent.secondary_weapon = weaponObj;
    }
    if (typeof agent.secondary_weapon !== 'object') agent.secondary_weapon = null;


    // --- 6. Map to Actions & Passives ---
    const extractEffects = (source, sourceName) => {
        if (!source) return;

        if (source.effects && Array.isArray(source.effects)) {
            source.effects.forEach(effect => {
                agent.actions.push({
                    ...effect,
                    source: source.name || sourceName,
                    sourceId: source.id
                });
            });
        }

        if (source.passiveModifiers && Array.isArray(source.passiveModifiers)) {
            source.passiveModifiers.forEach(mod => {
                agent.passives.push({
                    ...mod,
                    source: source.name || sourceName,
                    sourceId: source.id
                });
            });
        }
        
        if (source.feature) {
             extractEffects(source.feature, source.name);
        }
    };

    agent.features.forEach(f => extractEffects(f, "Class/Ancestry Feature"));
    agent.domainCards.forEach(c => extractEffects(c, "Domain Card"));
    if (armorData) extractEffects(armorData, "Armor");
    extractEffects(agent.primary_weapon, "Primary Weapon");
    if (agent.secondary_weapon) extractEffects(agent.secondary_weapon, "Secondary Weapon");

    // --- 7. Runtime Stats ---
    agent.max_armor_slots = agent.stats_snapshot.armor_slots;
    agent.current_hp = (agent.current_state?.hp != null) ? agent.current_state.hp : agent.stats_snapshot.max_hp;
    agent.max_hp = agent.stats_snapshot.max_hp;
    agent.current_stress = (agent.current_state?.stress != null) ? agent.current_state.stress : 0;
    agent.max_stress = agent.stats_snapshot.max_stress;
    agent.current_hope = (agent.current_state?.hope != null) ? agent.current_state.hope : 2;
    agent.max_hope = 6;
    agent.current_armor_slots = agent.stats_snapshot.armor_slots - (agent.current_state?.armor_slots_used || 0);
    agent.evasion = agent.stats_snapshot.evasion; 

    agent.is_hydrated = true;
    console.log('Agent Hydrated:', agent.name, agent.primary_weapon?.name, `Proficiency: ${agent.proficiency}`);
    return agent;
}

function instantiateAdversaryAgent(data) {
    if (data.type === 'adversary') {
        simLog(` (Re-using adversary agent: ${data.name} with ${data.current_hp} HP)`);

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
        thresholds: {
            major: data.major,
            severe: data.severe
        },
        features: data.features || [], 
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
    if (typeof damageString !== 'string') return 0;

    let totalDamage = 0;
    const parts = damageString.split('+');

    parts.forEach(part => {
        part = part.trim();
        if (part.includes('d')) {
            const dieSplit = part.split('d');
            let numDice = parseInt(dieSplit[0]) || 1;
            const dieType = parseInt(dieSplit[1]) || 4;
            const diceToRoll = (proficiency > 1) ? (numDice * proficiency) : numDice;

            for (let i = 0; i < diceToRoll; i++) {
                totalDamage += Math.floor(Math.random() * dieType) + 1;
            }
        } else {
            const val = parseInt(part);
            if (!isNaN(val)) {
                totalDamage += val;
            }
        }
    });

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
        case 'self': return true;
        case 'melee': return distance <= DAGGERHEART_RANGES.RANGE_MELEE;
        case 'very close': return distance <= DAGGERHEART_RANGES.RANGE_VERY_CLOSE;
        case 'close': return distance <= DAGGERHEART_RANGES.RANGE_CLOSE;
        case 'far': return distance <= DAGGERHEART_RANGES.RANGE_FAR;
        case 'very far': return distance <= DAGGERHEART_RANGES.RANGE_VERY_FAR;
        default:
            simLog(`(Warning: Unknown range name '${weaponRangeName}')`);
            return false;
    }
}

function moveAgentTowards(agent, target, gameState, isSprint = false) {
    let budget = isSprint ? DAGGERHEART_RANGES.RANGE_FAR : agent.speed; 
    
    let currentX = agent.position.x;
    let currentY = agent.position.y;
    let moved = false;

    while (budget > 0) {
        let movedThisStep = false;
        const dx = target.position.x - currentX;
        const dy = target.position.y - currentY;

        if (getAgentDistance({position: {x: currentX, y: currentY}}, target) <= 1) {
            break; 
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

        if (!movedThisStep) { 
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

function getAdversaryBpCost(adv) {
    if (!adv || !adv.type) return 0;
    let type = adv.type;
    if (type.includes('Horde')) type = 'Horde';
    
    switch (type) {
        case 'Solo': return 5;
        case 'Bruiser': return 4;
        case 'Leader': return 3;
        case 'Standard': 
        case 'Horde': 
        case 'Ranged': 
        case 'Skulk': return 2;
        case 'Minion': 
        case 'Social': 
        case 'Support': return 1;
        default: return 0;
    }
}

// --- EVENT LISTENER & STARTUP ---
window.addEventListener('SRD_DATA_READY', () => {
    console.log("Starting Sim Core...");
    initSimCore();
});