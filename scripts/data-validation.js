// --- STRICT DATA VALIDATION ---

const REQUIRED_FIELDS = {
    PLAYER: [
        "name", "level", "class.name", "class.starting_hp",
        "traits.strength", "traits.agility", "traits.finesse", "traits.instinct", "traits.presence", "traits.knowledge",
        "proficiency", "evasion", "majorThreshold", "severeThreshold",
        "equipment.primary.name", "equipment.primary.damage", "loadout"
    ],
    ADVERSARY: [
        "name", "tier", "difficulty", "hp", "stress", 
        "attack.name", "attack.damage"
        // Note: Thresholds handled with special logic below due to schema migration
    ],
    ENVIRONMENT: [
        "name", "tier", "difficulty"
    ]
};

/**
 * * deepCheck(obj, path) helper to check nested properties like 'traits.strength'
 * */
function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function validateAndCoerce(inputData, schemaType) {
    if (!inputData || typeof inputData !== 'object') {
        throw new Error(`Invalid input data: Input is not an object.`);
    }
    
    const required = REQUIRED_FIELDS[schemaType];
    if (!required) throw new Error(`Unknown schema type: ${schemaType}`);
    
    let cleanData = JSON.parse(JSON.stringify(inputData)); // Deep copy
    let missingFields = [];
    
    // --- 1. STRICT VALIDATION ---
    required.forEach(field => {
        const value = getNestedValue(cleanData, field);
        if (value === undefined || value === null || value === "") {
            missingFields.push(field);
        }
    });
    
    // Special Check for Adversary Thresholds (The \"Bear\" vs \"Acid Burrower\" issue)
    if (schemaType === 'ADVERSARY') {
        const hasNested = cleanData.thresholds && cleanData.thresholds.major && cleanData.thresholds.severe;
        const hasTopLevel = cleanData.major && cleanData.severe;
        
        // Minions (Tier 1/2 sometimes) might have null thresholds, but standard foes must have them.
        // We will enforce it for non-Minions if they have HP > 1.
        if (cleanData.hp > 1 && !hasNested && !hasTopLevel) {
            missingFields.push("thresholds (major/severe)");
        }
    }
    
    if (missingFields.length > 0) {
        throw new Error(`Missing VITAL data fields: ${missingFields.join(', ')}`);
    }
    
    // --- 2. TYPE COERCION & CLEANUP ---
     
    if (schemaType === 'ADVERSARY') {
        // Fix Thresholds Structure
        if (!cleanData.thresholds || !cleanData.thresholds.major) {
            if (cleanData.major && cleanData.severe) {
                cleanData.thresholds = { major: cleanData.major, severe: cleanData.severe };
                // Cleanup old keys
                delete cleanData.major;
                delete cleanData.severe;
            }
        }
        
        // Ensure numeric types
        cleanData.tier = parseInt(cleanData.tier);
        cleanData.difficulty = parseInt(cleanData.difficulty);
        cleanData.hp = parseInt(cleanData.hp);
        cleanData.stress = parseInt(cleanData.stress);
        if (cleanData.attack && cleanData.attack.modifier) {
            cleanData.attack.modifier = parseInt(cleanData.attack.modifier) || 0;
        }
    }
    
    if (schemaType === 'PLAYER') {
        // Ensure numeric types
        cleanData.level = parseInt(cleanData.level);
        cleanData.proficiency = parseInt(cleanData.proficiency);
        cleanData.evasion = parseInt(cleanData.evasion);
        cleanData.majorThreshold = parseInt(cleanData.majorThreshold);
        cleanData.severeThreshold = parseInt(cleanData.severeThreshold);
        
        // Ensure arrays
        if (!Array.isArray(cleanData.loadout)) cleanData.loadout = [];
    }
    
    if (schemaType === 'ENVIRONMENT') {
        cleanData.difficulty = parseInt(cleanData.difficulty);
        cleanData.tier = parseInt(cleanData.tier);
        if (!Array.isArray(cleanData.features)) cleanData.features = [];
    }

    return cleanData;
}

// --- EXPORT FOR NODE.JS ---
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateAndCoerce };
}