/*
 * CharacterFactory & UI Controller
 * Logic Layer for Agent Assembly and User Interface Handling.
 */

class CharacterFactory {
    /**
     * Creates a fully hydrated agent object from raw form data.
     * @param {Object} formData - Configuration object for the character.
     * @returns {Object} The constructed agent.
     */
    static createAgent(formData) {
        // 1. Initialize Skeleton Structure
        const agent = {
            id: crypto.randomUUID(),
            name: formData.name || "Unnamed Hero",
            level: parseInt(formData.level) || 1,
            class_key: formData.classId || formData.classKey,
            subclass_key: formData.subclassId || formData.subclassKey,
            // Core Data Containers
            stats: formData.stats || {
                strength: 0, agility: 0, finesse: 0,
                instinct: 0, presence: 0, knowledge: 0
            },
            derivedStats: {
                hp: 6,
                stress: 5,
                hope: 2,
                armor_slots: 0,
                thresholds: { minor: 1, major: 7, severe: 14 },
                evasion: 10
            },
            actions: [],
            passives: [],
            inventory: []
        };

        // 2. SRD Data Injection (Class & Derived Stats)
        // Use window global
        const FEATURES = window.class_features || window.CLASS_FEATURES;
        if (FEATURES) {
            const classKey = agent.class_key;
            const classData = FEATURES[classKey];

            if (classData) {
                // Derived Stats from Class (Defaults provided if missing in library)
                if (classData.hp) agent.derivedStats.hp = classData.hp;
                if (classData.stress) agent.derivedStats.stress = classData.stress;
                if (classData.thresholds) agent.derivedStats.thresholds = { ...classData.thresholds };

                // Class Feature (Hope Feature) Injection
                if (classData.classFeature) {
                    agent.actions.push(classData.classFeature);
                }

                // Evasion Calculation: 10 + Agility + Armor Bonus
                let armorBonus = 0;
                const armorId = formData.armorId || formData.armorKey;
                const ARMOR_LIB = window.ARMOR_LIBRARY || (window.item_library ? window.item_library.ARMOR_LIBRARY : null);
                
                if (armorId && ARMOR_LIB) {
                    const armor = ARMOR_LIB[armorId];
                    if (armor) {
                        // Check for passive modifiers (ActionObject schema) or legacy feature effect
                        if (armor.passiveModifiers) {
                            const mod = armor.passiveModifiers.find(m => m.target && m.target.toLowerCase() === 'evasion');
                            if (mod) armorBonus = mod.value;
                        } else if (armor.feature && armor.feature.effect && armor.feature.effect.stat === 'evasion') {
                            armorBonus = armor.feature.effect.value;
                        }
                        
                        // Add Armor to inventory
                        agent.inventory.push(armor);
                    }
                }
                agent.derivedStats.evasion = 10 + (agent.stats.agility || 0) + armorBonus;

                // Subclass Features
                const subclassKey = agent.subclass_key;
                if (subclassKey && classData.subclasses && classData.subclasses[subclassKey]) {
                    const features = classData.subclasses[subclassKey];
                    if (Array.isArray(features)) {
                        features.forEach(feat => {
                            // TIER 1 COMPLIANCE: Only load FOUNDATION features
                            if (feat.tier === 'FOUNDATION') {
                                // Determine if Active or Passive based on type or tags
                                const isActive = (feat.type && (feat.type === 'ACTION' || feat.type === 'REACTION' || feat.type === 'ACTION_OPTION')) || 
                                                 (feat.tags && feat.tags.some(t => t.toUpperCase() === 'ACTION' || t.toUpperCase() === 'REACTION'));
                                
                                if (isActive) {
                                    agent.actions.push(feat);
                                } else {
                                    agent.passives.push(feat);
                                }
                            }
                        });
                    }
                }
            }
        }

        // 2b. Ancestry & Community Data Injection (NEW)
        const ANCESTRY_LIB = window.ANCESTRY_LIBRARY || window.ancestry_library;
        const COMMUNITY_LIB = window.COMMUNITY_LIBRARY || window.community_library;

        // Inject Ancestry
        if (formData.ancestryId && ANCESTRY_LIB && ANCESTRY_LIB[formData.ancestryId]) {
            const ancestry = ANCESTRY_LIB[formData.ancestryId];
            if (ancestry.features) {
                ancestry.features.forEach(feat => {
                    const isActive = (feat.type && (feat.type === 'ACTION' || feat.type === 'REACTION' || feat.type === 'ACTION_OPTION'));
                    if (isActive) {
                        agent.actions.push({ ...feat, source: "Ancestry" });
                    } else {
                        agent.passives.push({ ...feat, source: "Ancestry" });
                    }
                });
            }
        }

        // Inject Community
        if (formData.communityId && COMMUNITY_LIB && COMMUNITY_LIB[formData.communityId]) {
            const community = COMMUNITY_LIB[formData.communityId];
            if (community.features) {
                community.features.forEach(feat => {
                    const isActive = (feat.type && (feat.type === 'ACTION' || feat.type === 'REACTION' || feat.type === 'ACTION_OPTION'));
                    if (isActive) {
                        agent.actions.push({ ...feat, source: "Community" });
                    } else {
                        agent.passives.push({ ...feat, source: "Community" });
                    }
                });
            }
        }

        // 3. Weapon-to-Action Logic (Explicit Fix for Missing Attack Bug)
        const weaponId = formData.weaponId || formData.primaryWeaponKey;
        const WEAPON_LIB = window.WEAPON_LIBRARY || (window.item_library ? window.item_library.WEAPON_LIBRARY : null);
        
        if (weaponId && WEAPON_LIB) {
            // Lookup weapon in the global library
            let weapon = WEAPON_LIB[weaponId];
            
            if (!weapon) {
                // Fallback search if not found by direct key
                weapon = Object.values(WEAPON_LIB).find(w => w.id === weaponId);
            }

            if (weapon) {
                agent.inventory.push(weapon);

                // Create Action Object (Functional representation)
                const attackAction = {
                    id: weapon.id,
                    type: 'ATTACK', // Explicit Type override for Engine
                    name: weapon.name,
                    range: weapon.range,
                    tags: weapon.tags,
                    // Spread stats directly: baseDice, damageType, statToRoll, flatBonus
                    ...weapon.stats 
                };

                agent.actions.push(attackAction);
            } else {
                console.warn(`CharacterFactory: Weapon ID '${weaponId}' not found in library.`);
            }
        }

        // 4. Load Secondary Weapon (Optional extension of logic)
        const secWeaponId = formData.secondaryWeaponId || formData.secondaryWeaponKey;
        if (secWeaponId && WEAPON_LIB) {
             let secWeapon = WEAPON_LIB[secWeaponId] || Object.values(WEAPON_LIB).find(w => w.id === secWeaponId);
             if (secWeapon) {
                 agent.inventory.push(secWeapon);
                 // Secondary weapons might be ACTIONS (e.g. Dagger) or PASSIVES (e.g. Shield)
                 // Check if it has stats to determine if it's an attack
                 if (secWeapon.stats && secWeapon.stats.baseDice) {
                     agent.actions.push({
                        id: secWeapon.id,
                        type: 'ATTACK',
                        name: secWeapon.name,
                        range: secWeapon.range,
                        tags: secWeapon.tags,
                        ...secWeapon.stats
                     });
                 }
             }
        }

        // 5. Load Domain Cards (Updated for Multiple Selections)
        const DOMAIN_LIB = window.DOMAIN_CARD_LIBRARY || {};
        
        // Handle Array of Cards (New System)
        if (formData.domainCards && Array.isArray(formData.domainCards)) {
             formData.domainCards.forEach(cId => {
                 if (DOMAIN_LIB[cId]) {
                     agent.inventory.push(DOMAIN_LIB[cId]);
                 }
             });
        }

        // Handle Single Card (Backward Compatibility)
        const cardId = formData.domainCardId;
        if (cardId && DOMAIN_LIB[cardId]) {
            // Avoid duplicates if ID is also in array
            const alreadyAdded = agent.inventory.some(item => item.id === cardId);
            if (!alreadyAdded) {
                agent.inventory.push(DOMAIN_LIB[cardId]);
            }
        }
        
        // Validation Log
        console.log("Constructed Agent Actions:", agent.actions);

        return agent;
    }
}

// -- Global Modal Functions (for HTML onclick compatibility) --
window.openBuilderModal = function() {
    const modal = document.getElementById('builder-modal');
    if (modal) {
        modal.style.display = 'flex'; // Flex to handle layout better
    }
};

window.closeBuilderModal = function() {
    const modal = document.getElementById('builder-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

/**
 * Handles the creation of a character from the Builder Modal.
 * Gathers data from DOM, creates agent, and pushes to global pool.
 */
function handleCreateCharacter() {
    console.log("Handling Create Character...");
    
    // 1. Gather Basic Info
    const nameInput = document.getElementById('builder-name');
    const levelInput = document.getElementById('builder-level');
    const classSelect = document.getElementById('builder-class');
    const subclassSelect = document.getElementById('builder-subclass');
    const ancestrySelect = document.getElementById('builder-ancestry');
    const communitySelect = document.getElementById('builder-community');
    
    if (!classSelect || !classSelect.value) {
        alert("Please select a Class.");
        return;
    }

    const name = nameInput ? nameInput.value : "Unnamed Hero";
    const level = levelInput ? parseInt(levelInput.value) : 1;
    const classId = classSelect.value;
    const subclassId = subclassSelect ? subclassSelect.value : null;
    const ancestryId = ancestrySelect ? ancestrySelect.value : null;
    const communityId = communitySelect ? communitySelect.value : null;

    // 2. Gather Stats
    const getStat = (id) => {
        const el = document.getElementById(id);
        return el ? (parseInt(el.value) || 0) : 0;
    };

    const stats = {
        strength: getStat('trait-str'),
        agility: getStat('trait-agi'),
        finesse: getStat('trait-fin'),
        instinct: getStat('trait-ins'),
        presence: getStat('trait-pre'),
        knowledge: getStat('trait-kno')
    };

    // 3. Gather Equipment
    const weapon1Select = document.getElementById('builder-weapon-1');
    const weapon2Select = document.getElementById('builder-weapon-2');
    const armorSelect = document.getElementById('builder-armor');

    const weapon1Id = weapon1Select ? weapon1Select.value : null;
    const weapon2Id = weapon2Select ? weapon2Select.value : null;
    const armorId = armorSelect ? armorSelect.value : null;
    
    // NEW: Gather Checkboxes for Domain Cards
    const checkedCards = document.querySelectorAll('#builder-cards-container input[type="checkbox"]:checked');
    const selectedCardIds = Array.from(checkedCards).map(cb => cb.value);

    // 4. Construct Form Data
    const formData = {
        name: name,
        level: level,
        classId: classId,
        subclassId: subclassId,
        ancestryId: ancestryId,
        communityId: communityId,
        stats: stats,
        weaponId: weapon1Id,
        secondaryWeaponId: weapon2Id,
        armorId: armorId,
        domainCards: selectedCardIds // New array of selected IDs
    };

    // 5. Create Agent via Factory
    try {
        const newAgent = CharacterFactory.createAgent(formData);
        
        // 6. Add to Global Pool (Integration with ui-controller.js)
        if (typeof playerPool !== 'undefined') {
            // Generate a simulation ID consistent with ui-controller logic
            newAgent.simId = `player-custom-${Date.now()}`;
            playerPool.push(newAgent);
            console.log("Agent added to playerPool:", newAgent);
            
            // Refresh UI if render function exists
            if (typeof renderPools === 'function') {
                renderPools();
            }
            
            // Close Modal
            window.closeBuilderModal();
            
        } else {
            console.error("playerPool is not defined. Cannot add character.");
            alert("Error: Player Pool system not found. Check console.");
        }
        
    } catch (e) {
        console.error("Failed to create character:", e);
        alert("Failed to create character. See console for details.");
    }
}

/**
 * Initializes the Character Builder UI.
 * Populates dropdowns and sets up event listeners.
 */
function initializeCharacterBuilder() {
    console.log("Initializing Character Builder UI...");

    // Defensive Check: Ensure Global Libraries are Loaded
    if (!window.item_library || !window.class_features) {
        console.error("CRITICAL: Character Builder dependencies (item_library or class_features) are missing from window scope.");
    }

    // 1. Add Class-to-Domain Map
    const CLASS_DOMAINS = {
        "Bard": ["Grace", "Codex"],
        "Druid": ["Sage", "Arcana"],
        "Guardian": ["Valor", "Blade"],
        "Ranger": ["Bone", "Sage"],
        "Rogue": ["Midnight", "Grace"],
        "Seraph": ["Splendor", "Valor"],
        "Sorcerer": ["Arcana", "Midnight"],
        "Warrior": ["Blade", "Bone"],
        "Wizard": ["Codex", "Splendor"]
    };

    // 2. Create renderDomainCards Function
    const renderDomainCards = (classKey) => {
        const container = document.getElementById('builder-cards-container');
        if (!container) return;
        
        container.innerHTML = ''; // Clear previous contents
        
        const validDomains = CLASS_DOMAINS[classKey];
        if (!validDomains) {
            container.innerHTML = '<div style="color:#888; padding:5px; font-size:0.9em;">Select a Class to see valid domain cards.</div>';
            return;
        }

        const DOMAIN_LIB = window.DOMAIN_CARD_LIBRARY || {};
        const cards = Object.values(DOMAIN_LIB).filter(card => {
            // Check if card has required domain tags
            const hasDomain = card.tags && card.tags.some(t => validDomains.includes(t));
            // Check for Tier 1 compliance (handling string or integer tier)
            const isTier1 = card.tier == 1; 
            return hasDomain && isTier1;
        });

        if (cards.length === 0) {
            container.innerHTML = '<div style="color:#888; padding:5px; font-size:0.9em;">No Tier 1 cards found for this class.</div>';
            return;
        }

        // Render Cards
        cards.forEach(card => {
            const wrapper = document.createElement('div');
            wrapper.className = 'domain-card-option';
            wrapper.style.cssText = 'margin-bottom:10px; padding:10px; background:#2a2a2a; border:1px solid #444; border-radius:4px;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:5px;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = card.id;
            checkbox.id = `card-${card.id}`;
            checkbox.name = 'builder-domain-cards-selection'; // Helper for future form gathering

            const label = document.createElement('label');
            label.htmlFor = `card-${card.id}`;
            label.style.fontWeight = 'bold';
            label.style.cursor = 'pointer';
            label.textContent = card.name;
            
            const domainTag = document.createElement('span');
            domainTag.style.cssText = 'font-size:0.8em; color:#aaa; margin-left:auto;';
            domainTag.textContent = card.tags ? card.tags.find(t => validDomains.includes(t)) || card.tags[0] : 'Domain';

            header.appendChild(checkbox);
            header.appendChild(label);
            header.appendChild(domainTag);

            const desc = document.createElement('div');
            desc.style.cssText = 'font-size:0.85em; color:#ccc; line-height:1.4; padding-left:24px;';
            desc.textContent = card.description || 'No description available.';

            wrapper.appendChild(header);
            wrapper.appendChild(desc);
            container.appendChild(wrapper);
        });
    };

    // Define Action Variables
    const primaryWeapons = (window.item_library.weapons || []).filter(w => w.type === 'PRIMARY WEAPON');
    const secondaryWeapons = (window.item_library.weapons || []).filter(w => w.type === 'SECONDARY WEAPON');
    
    console.log(`Primary Weapons Loaded: ${primaryWeapons.length}`);
    console.log(`Secondary Weapons Loaded: ${secondaryWeapons.length}`);

    const classSelect = document.getElementById('builder-class');
    const subclassSelect = document.getElementById('builder-subclass');
    const ancestrySelect = document.getElementById('builder-ancestry');
    const communitySelect = document.getElementById('builder-community');
    const weaponSelect1 = document.getElementById('builder-weapon-1');
    const weaponSelect2 = document.getElementById('builder-weapon-2');
    const armorSelect = document.getElementById('builder-armor');
    const cardsSelect = document.getElementById('builder-domain-cards');
    
    // Modal Control Elements
    const openBtn = document.querySelector('.sim-controls button[onclick*="openBuilderModal"]') || document.querySelector('.sim-controls button');
    const closeBtn = document.querySelector('#builder-modal .close') || document.querySelector('#builder-modal button[onclick*="closeBuilderModal"]');


    // Helper to create options
    const createOption = (value, text) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        return opt;
    };

    // 1. Populate Class & Subclass
    // Explicitly use window.class_features
    const FEATURES = window.class_features || window.CLASS_FEATURES;
    
    if (classSelect && FEATURES) {
        classSelect.innerHTML = '<option value="">-- Select Class --</option>';
        Object.keys(FEATURES).forEach(key => {
            classSelect.appendChild(createOption(key, FEATURES[key].name));
        });

        classSelect.addEventListener('change', () => {
            subclassSelect.innerHTML = '<option value="">-- Select Subclass --</option>';
            subclassSelect.disabled = false;
            const cls = FEATURES[classSelect.value];
            if (cls && cls.subclasses) {
                Object.keys(cls.subclasses).forEach(subKey => {
                    subclassSelect.appendChild(createOption(subKey, subKey));
                });
            }
            
            // 3. Connect to Event Listener: Update Domain Cards
            renderDomainCards(classSelect.value);
        });
    } else {
        console.warn("Character Builder: Class Features library not found.");
    }

    // 1b. Populate Ancestry & Community
    const ANCESTRY_LIB = window.ANCESTRY_LIBRARY || window.ancestry_library;
    const COMMUNITY_LIB = window.COMMUNITY_LIBRARY || window.community_library;

    if (ancestrySelect && ANCESTRY_LIB) {
        ancestrySelect.innerHTML = '<option value="">-- Select Ancestry --</option>';
        Object.keys(ANCESTRY_LIB).forEach(key => {
            // Using key as value, and name from object for text
            ancestrySelect.appendChild(createOption(key, ANCESTRY_LIB[key].name));
        });
    }

    if (communitySelect && COMMUNITY_LIB) {
        communitySelect.innerHTML = '<option value="">-- Select Community --</option>';
        Object.keys(COMMUNITY_LIB).forEach(key => {
            communitySelect.appendChild(createOption(key, COMMUNITY_LIB[key].name));
        });
    }

    // 2. Populate Weapons
    const populateDropdown = (selectEl, items, placeholder) => {
        if (!selectEl) return;
        selectEl.innerHTML = `<option value="">${placeholder}</option>`;
        
        items.forEach(w => {
             const dmg = (w.stats && w.stats.baseDice) ? w.stats.baseDice : '?';
             const text = `${w.name} - ${dmg}`;
             selectEl.appendChild(createOption(w.id, text));
        });
    };

    populateDropdown(weaponSelect1, primaryWeapons, "-- Select Primary Weapon --");
    populateDropdown(weaponSelect2, secondaryWeapons, "-- Select Secondary Weapon --");


    // 3. Populate Armor
    const ARMOR_LIB = window.ARMOR_LIBRARY || (window.item_library ? window.item_library.ARMOR_LIBRARY : null);
    if (armorSelect && ARMOR_LIB) {
        armorSelect.innerHTML = '<option value="">-- Select Armor --</option>';
        Object.values(ARMOR_LIB).forEach(a => {
            armorSelect.appendChild(createOption(a.id, `${a.name} (Score: ${a.stats ? a.stats.armorScore : '?'})`));
        });
    }
    
    // 4. Populate Domain Cards (Legacy - preserved for reference but superseded by dynamic render)
    const DOMAIN_LIB = window.DOMAIN_CARD_LIBRARY || {};
    if (cardsSelect && DOMAIN_LIB) {
        cardsSelect.innerHTML = '<option value="">-- Select Card --</option>';
        Object.keys(DOMAIN_LIB).forEach(key => {
            const card = DOMAIN_LIB[key];
            cardsSelect.appendChild(createOption(key, `${card.name} (${card.tags ? card.tags[0] : 'Domain'})`));
        });
    }

    // 5. Listeners
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            window.closeBuilderModal();
        });
    }
    
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            window.openBuilderModal();
        });
    }

    // Attach Create Handler
    window.saveBuilderCharacter = handleCreateCharacter;
}

window.addEventListener('SRD_DATA_READY', () => {
    console.log("Signal Received: Initializing Character Builder...");
    if (typeof initializeCharacterBuilder === 'function') {
        initializeCharacterBuilder();
    }
});

// Export Globally
if (typeof window !== 'undefined') {
    window.CharacterFactory = CharacterFactory;
    window.initializeCharacterBuilder = initializeCharacterBuilder;
    window.handleCreateCharacter = handleCreateCharacter;
    // Map the function called by HTML onclick
    window.saveBuilderCharacter = handleCreateCharacter;
}