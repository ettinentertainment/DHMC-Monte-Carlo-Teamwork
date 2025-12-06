// --- SIM ENGINE RESOLUTION ---
// Handles the mechanical resolution of actions, rolls, and effects.
// Consumes ActionObjects and Agent States.

/**
 * Resolves a standard Daggerheart Action Roll (2d12 + Mod).
 * Handles Advantage/Disadvantage (d6 mechanic).
 * @param {number} difficulty - The Target Number (TN).
 * @param {number} traitModifier - The agent's trait value (e.g., Strength +2).
 * @param {boolean} hasAdvantage - Whether the roll has advantage.
 * @param {boolean} hasDisadvantage - Whether the roll has disadvantage.
 * @returns {Object} Result object { total, outcome, dice: [] }
 */
function resolveActionRoll(difficulty, traitModifier, hasAdvantage = false, hasDisadvantage = false) {
    const hopeDie = Math.floor(Math.random() * 12) + 1;
    const fearDie = Math.floor(Math.random() * 12) + 1;
    let dicePool = [hopeDie, fearDie];
    let droppedDie = null;

    // SRD 1.5: Advantage/Disadvantage adds a d6
    if (hasAdvantage) {
        const advDie = Math.floor(Math.random() * 6) + 1;
        dicePool.push(advDie);
        // Drop the lowest die
        dicePool.sort((a, b) => b - a); // Descending
        droppedDie = dicePool.pop(); // Remove lowest
    } else if (hasDisadvantage) {
        const disDie = Math.floor(Math.random() * 6) + 1;
        dicePool.push(disDie);
        // Drop the highest die
        dicePool.sort((a, b) => a - b); // Ascending
        droppedDie = dicePool.pop(); // Remove highest
    }

    // The remaining two dice are the "Action Dice" (Effective Hope/Fear)
    // We need to map them back to Hope/Fear concepts. 
    // In standard rolls: Die 1 is Hope, Die 2 is Fear.
    // With Adv/Dis, it's abstract, but for Fear generation purposes we usually take the two results.
    // Daggerheart doesn't explicitly assign "Hope" vs "Fear" die when using Adv/Dis d6, 
    // typically the highest value is treated as the primary result determinant.
    // For sim simplicity: The higher remaining die is Hope, lower is Fear.
    
    const finalDice = dicePool.sort((a, b) => b - a);
    const effectiveHope = finalDice[0];
    const effectiveFear = finalDice[1];

    const total = effectiveHope + effectiveFear + traitModifier;

    let outcome = '';
    if (effectiveHope === effectiveFear) {
        outcome = 'CRITICAL_SUCCESS';
    } else if (total >= difficulty) {
        outcome = (effectiveHope > effectiveFear) ? 'SUCCESS_WITH_HOPE' : 'SUCCESS_WITH_FEAR';
    } else {
        outcome = (effectiveHope > effectiveFear) ? 'FAILURE_WITH_HOPE' : 'FAILURE_WITH_FEAR';
    }

    simLog(` Action Roll: [${effectiveHope}, ${effectiveFear}] (Dropped: ${droppedDie || '-'}) + ${traitModifier} = ${total} vs DC ${difficulty} -> ${outcome}`);

    return {
        total,
        outcome,
        hopeValue: effectiveHope,
        fearValue: effectiveFear,
        isCrit: effectiveHope === effectiveFear
    };
}

/**
 * Calculates damage based on SRD Rules: (BaseDice * Proficiency) + Modifiers.
 * @param {Object} stats - The stats object from an ActionObject ({ baseDice: "1d8", flatBonus: 2 }).
 * @param {number} proficiency - The agent's proficiency (Tier).
 * @param {boolean} isCrit - Whether to apply crit rules (Max damage or extra dice).
 * @returns {Object} { total: number, text: string }
 */
function calculateDamage(stats, proficiency, isCrit = false) {
    if (!stats || !stats.baseDice) return { total: 0, text: "0" };

    // Parse "1d8"
    const parts = stats.baseDice.toLowerCase().split('d');
    const baseCount = parseInt(parts[0]) || 1;
    const dieSize = parseInt(parts[1]) || 6;
    
    // SRD Scaling: Dice Count = Base * Proficiency
    // Note: Some items don't scale (scaling: false), but standard weapons do.
    // We assume scaling unless explicitly disabled or agent is adversary (handled differently).
    const diceCount = (stats.scaling !== false) ? (baseCount * proficiency) : baseCount;

    let total = 0;
    let rollString = `${diceCount}d${dieSize}`;

    for (let i = 0; i < diceCount; i++) {
        total += Math.floor(Math.random() * dieSize) + 1;
    }

    // Modifiers
    const flat = stats.flatBonus || 0;
    total += flat;

    // Crit: Daggerheart Crits often add max damage of the dice or double. 
    // For Sim v1.5: Add Max Value of the Dice Pool (SRD common interpretation).
    if (isCrit) {
        const critBonus = diceCount * dieSize;
        total += critBonus;
        rollString += ` (CRIT +${critBonus})`;
    }

    return { total, text: `${total} (${rollString} + ${flat})` };
}

/**
 * Processes a specific ActionObject enacted by an agent against a target.
 * @param {Object} agent - The acting agent.
 * @param {Object} target - The target agent.
 * @param {Object} action - The ActionObject (hydrated).
 * @param {Object} gameState - Current state.
 * @returns {Object} The result of the action { outcome: string, damage: number, ... }
 */
function processAction(agent, target, action, gameState) {
    simLog(`Processing Action: ${action.name || action.type} by ${agent.name}`);

    // 1. Determine Trait and Difficulty
    // Default to Agility vs Evasion/Difficulty if not specified
    let traitToRoll = "agility";
    if (action.stats && action.stats.statToRoll) {
        traitToRoll = action.stats.statToRoll.toLowerCase();
    }
    
    const traitValue = agent.traits[traitToRoll] || 0;
    
    // Target Difficulty: Evasion (for attacks) or Scene Difficulty (for checks)
    let difficulty = gameState.sceneDifficulty;
    const isAttack = (action.type === 'ATTACK' || action.type === 'WEAPON_ATTACK' || action.type === 'SPELLCAST_ROLL');
    
    if (isAttack && target) {
        difficulty = target.evasion || 10;
    } else if (action.difficulty) {
        difficulty = action.difficulty;
    }

    // 2. Check Advantage (From Passives/Conditions)
    const hasAdvantage = agent.conditions.includes("Advantage") || action.tags?.includes("Advantage");
    const hasDisadvantage = agent.conditions.includes("Disadvantage") || agent.conditions.includes("Restrained");

    // 3. Roll
    const result = resolveActionRoll(difficulty, traitValue, hasAdvantage, hasDisadvantage);

    // 4. Apply Effects based on Outcome
    if (result.outcome.includes('SUCCESS')) {
        
        // DEAL DAMAGE
        if (action.type === 'ATTACK' || action.type === 'WEAPON_ATTACK' || action.type === 'DEAL_DAMAGE' || (action.stats && action.stats.baseDice)) {
            const dmgResult = calculateDamage(action.stats, agent.proficiency, result.isCrit);
            simLog(` -> Hit! Dealing ${dmgResult.text} ${action.stats.damageType || "Physical"} damage.`);
            
            // Apply to target (Assuming applyDamage exists in utils, or we do it here)
            if (typeof applyDamage === 'function') {
                applyDamage(target, dmgResult.total, action.stats.damageType || "Physical", gameState);
            }
        }

        // APPLY CONDITIONS (from effects array)
        if (action.effects) {
            action.effects.forEach(effect => {
                if (effect.type === 'APPLY_CONDITION' && target) {
                    target.conditions.push(effect.condition);
                    simLog(` -> Applied Condition: ${effect.condition} to ${target.name}`);
                }
                if (effect.type === 'HEAL_TARGET' && target) {
                    // Simple Heal Logic
                    const healVal = effect.value || 1;
                    target.current_hp = Math.min(target.max_hp, target.current_hp + healVal);
                    simLog(` -> Healed ${target.name} for ${healVal} HP.`);
                }
                // Handle nested conditional effects if needed
                if (effect.type === 'CONDITIONAL_EFFECT' && effect.details) {
                    // Simplified logic for immediate effects
                    if (effect.details.type === 'DEAL_DAMAGE' && target) {
                         // Handle bonus damage
                    }
                }
            });
        }
    } else {
        simLog(` -> Miss/Fail.`);
        // Handle Fear generation on fail? (Already handled in logic engine usually)
    }

    return result;
}

// Expose functions
if (typeof window !== 'undefined') {
    window.processAction = processAction;
    window.resolveActionRoll = resolveActionRoll;
    window.calculateDamage = calculateDamage;
}