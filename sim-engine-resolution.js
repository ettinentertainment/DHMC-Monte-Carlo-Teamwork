// --- RESOLUTION ENGINE ---
// Handles specific action effects, dice rolls, damage application, and triggers.

// simLog(message) captures text *during* a simulation run
function simLog(message, type = 'log-system') {
    console.log(message);
    BATCH_LOG.push({ message: message, type: type });
}

// NEW: Unified State Checker
function getCombatState(attacker, target, gameState) {
    const context = { advantage: false, disadvantage: false, movementPrevented: false };
    
    // Check modifiers on the target (e.g., they are Vulnerable)
    evaluateTriggers(target, 'CHECK_INCOMING_ADVANTAGE', context, gameState);
    
    // Check modifiers on the attacker (e.g., they are Hidden)
    evaluateTriggers(attacker, 'CHECK_OUTGOING_ADVANTAGE', context, gameState);

    // Logic: Advantage cancels Disadvantage
    const hasAdvantage = context.advantage && !context.disadvantage;
    const hasDisadvantage = context.disadvantage && !context.advantage;

    return { hasAdvantage, hasDisadvantage, movementPrevented: context.movementPrevented };
}

function isCardActionPossible(player, card, actionInfo, target, gameState) {
    // Check Range
    const range = actionInfo.range || 'Melee';
    if (range.toLowerCase() !== 'self' && !isTargetInRange(player, target, range)) {
        return false;
    }

    // Check Cost (Hope)
    if (actionInfo.cost && actionInfo.cost.type === 'hope') {
        if (actionInfo.cost.value === 'X') { // For 'Arcane Barrage'
            if (player.current_hope < 1) return false;
        } else if (player.current_hope < actionInfo.cost.value) {
            return false;
        }
    }

    // Check Cost (Stress)
    if (actionInfo.cost && actionInfo.cost.type === 'stress') {
        if (player.current_stress + actionInfo.cost.value > player.max_stress) {
            return false;
        }
    }

    // Check Limit (Once per rest)
    if (actionInfo.limit && actionInfo.limit.includes('Once per rest')) {
        if (player.abilityUsage[`${card.name}_${actionInfo.name}`]) {
            return false;
        }
    }
    
    return true;
}

function isCombatRelevant(parsedEffect) {
    if (!parsedEffect || !parsedEffect.actions) return false;
    // Returns true if the action does something mechanical in combat
    return parsedEffect.actions.some(a =>
        ['DEAL_DAMAGE', 'APPLY_CONDITION', 'HEAL_TARGET', 'HEAL_SELF', 'FORCE_REACTION_ROLL', 'WEAPON_ATTACK', 'SPELLCAST_ROLL', 'MULTI_ACTION', 'SUMMON_ADVERSARY', 'GAIN_HOPE', 'GAIN_FEAR', 'DEAL_STRESS', 'REPLENISH_TOKENS', 'SPEND_TOKEN'].includes(a.action_type)
    );
}

function executePCBasicAttack(player, target, gameState) {
    simLog(` -> Attacking with ${player.primary_weapon.name}!`, 'log-player');
    const traitName = player.primary_weapon.trait.toLowerCase();
    let traitMod = player.traits[traitName];

    // UPDATED: Use Unified State
    const combatState = getCombatState(player, target, gameState);
    if (combatState.hasAdvantage) {
        simLog(` -> Player has Advantage!`);
        traitMod += 2; // Simulating approx advantage benefit
    }
    if (combatState.hasDisadvantage) {
        simLog(` -> Player has Disadvantage!`);
        traitMod -= 2;
    }

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

function executePCDomainAction(player, card, actionInfo, target, gameState) {
    simLog(` -> Executing Domain Action: "${actionInfo.name || card.name}"`, 'log-player');

    // Initialize Resource Pool for Token mechanics (e.g. Rally Dice, Runes)
    if (card.token_mechanic) {
        if (!player.resources) player.resources = {};
        if (player.resources[card.name] === undefined) {
            player.resources[card.name] = 0;
            simLog(` -> Initialized resource pool for [${card.name}].`);
        }
    }

    let mainResult = null; // To store the result of the primary roll

    // --- 1. Handle Costs ---
    if (actionInfo.cost) {
        if (actionInfo.cost.type === 'hope') {
            if (actionInfo.cost.value === 'X') {
                if (player.current_hope >= 1) {
                    player.current_hope--;
                    simLog(` -> Spent 1 Hope (for X cost) (Total: ${player.current_hope})`);
                    actionInfo.hopeSpent = 1;
                } else {
                    simLog(` -> Not enough Hope for 'X' cost! Action fails.`);
                    return { outcome: 'FAILURE_WITH_FEAR' };
                }
            } else if (player.current_hope >= actionInfo.cost.value) {
                player.current_hope -= actionInfo.cost.value;
                simLog(` -> Spent ${actionInfo.cost.value} Hope (Total: ${player.current_hope})`);
            } else {
                simLog(` -> Not enough Hope! (Cost: ${actionInfo.cost.value}) Action fails.`);
                return { outcome: 'FAILURE_WITH_FEAR' };
            }
        }
        if (actionInfo.cost.type === 'stress') {
            if (player.current_stress + actionInfo.cost.value <= player.max_stress) {
                player.current_stress += actionInfo.cost.value;
                simLog(` -> Marked ${actionInfo.cost.value} Stress (Total: ${player.current_stress})`);
            } else {
                simLog(` -> Not enough Stress capacity! (Cost: ${actionInfo.cost.value}) Action fails.`);
                return { outcome: 'FAILURE_WITH_FEAR' };
            }
        }
    }

    // --- 2. Handle Limits ---
    if (actionInfo.limit && actionInfo.limit.includes('Once per rest')) {
        player.abilityUsage[`${card.name}_${actionInfo.name}`] = true;
        simLog(` -> (Marking '${actionInfo.name || card.name}' as used for this rest)`);
    }

    // --- 3. Execute Parsed Actions ---
    if (actionInfo.actions && Array.isArray(actionInfo.actions)) {
        for (const action of actionInfo.actions) {
            const context = { rollResult: mainResult, card: card, actionInfo: actionInfo };
            mainResult = executeParsedEffect(action, player, target, gameState, context);
        }
    }

    return mainResult || { outcome: 'SUCCESS_WITH_HOPE' };
}

function executeParsedEffect(action, agent, target, gameState, context = {}) {
    let primaryTarget = target;
    let targets = [target];

    const isPC = (agent.type === 'player');
    const rollResult = context.rollResult;

    // --- Target Acquisition ---
    const actionRange = action.range || 'Very Close';
    if (action.target === "ALL_IN_RANGE" || action.target === "ALL_IN_RANGE_FRONT" || action.target === "ALL_AFFECTED") {
        const targetList = isPC ? gameState.adversaries : gameState.players;
        targets = targetList.filter(t => t.current_hp > 0 && isTargetInRange(agent, t, actionRange));
        simLog(` -> Action targets ${targets.length} entities in ${actionRange} range!`);
        if (targets.length === 0) {
            simLog(` -> No entities in range. Action fails.`);
            return rollResult;
        }
        primaryTarget = targets[0];
    } else if (action.target === "ALLY_TARGET") {
        const ally = gameState.players.find(p => p.current_hp > 0 && p.id !== agent.id);
        if (ally) {
            primaryTarget = ally;
            targets = [ally];
            simLog(` -> Action targets ally: ${ally.name}`);
        } else {
            simLog(` -> No valid ally target found for action.`);
            return rollResult;
        }
    }

    // --- Cost Handling ---
    if (action.cost) {
        if (action.cost.type === 'hope') {
            if (agent.current_hope >= action.cost.value) {
                agent.current_hope -= action.cost.value;
                simLog(` -> (Effect) Spent ${action.cost.value} Hope (Total: ${agent.current_hope})`);
            } else {
                simLog(` -> (Effect) Cannot afford Hope cost. Effect fails.`);
                return rollResult;
            }
        }
    }

    // --- Main Action Switch ---
    switch (action.action_type) {
        case 'GRANT_ADVANTAGE':
            context.advantage = true;
            simLog(` -> Effect grants Advantage!`);
            break;

        case 'GRANT_DISADVANTAGE':
            context.disadvantage = true;
            simLog(` -> Effect grants Disadvantage!`);
            break;

        case 'PREVENT_MOVEMENT':
            context.movementPrevented = true;
            simLog(` -> Effect prevents movement!`);
            break;

        case 'REPLENISH_TOKENS': {
            const tokenData = context.card?.token_mechanic;
            if (tokenData) {
                let max = 0;
                if (typeof tokenData.max_tokens === 'string') {
                    const traitKey = (tokenData.max_tokens === 'Spellcast') ? agent.spellcastTrait : tokenData.max_tokens.toLowerCase();
                    max = agent.traits[traitKey] || 1;
                } else {
                    max = tokenData.max_tokens || 3;
                }
                max = Math.max(1, max);
                if (!agent.resources) agent.resources = {};
                agent.resources[context.card.name] = max;
                simLog(` -> Replenished [${context.card.name}] tokens to ${max}.`);
            }
            break;
        }

        case 'SPEND_TOKEN': {
            if (agent.resources && agent.resources[context.card.name] > 0) {
                agent.resources[context.card.name]--;
                simLog(` -> Spent 1 [${context.card.name}] token. (Remaining: ${agent.resources[context.card.name]})`);
                if (action.details) {
                    const nestedAction = Array.isArray(action.details) ? action.details[0] : action.details;
                    executeParsedEffect(nestedAction, agent, primaryTarget, gameState, context);
                }
            } else {
                simLog(` -> Failed to spend token for [${context.card.name}] - Pool empty!`);
            }
            break;
        }

        case 'PREVENT_HP_MARK':
            if (context.damageEvent) {
                const reduction = action.value || 0;
                const oldMark = context.damageEvent.hpToMark;
                context.damageEvent.hpToMark = Math.max(0, context.damageEvent.hpToMark - reduction);
                simLog(` -> Mitigated ${reduction} HP via ${context.card?.name || 'Feature'}. (HP to Mark: ${oldMark} -> ${context.damageEvent.hpToMark})`);
            }
            break;

        case 'REDUCE_DAMAGE':
            if (context.damageEvent) {
                let reduction = action.value || 0;
                if (action.bonus_die) {
                    reduction = rollDamage(action.bonus_die, 1, 0);
                }
                context.damageEvent.amount = Math.max(0, context.damageEvent.amount - reduction);
                simLog(` -> Reduced incoming damage by ${reduction}! (New Amount: ${context.damageEvent.amount})`);
            }
            break;

        case 'TELEPORT':
            simLog(` -> ${agent.name} teleports!`);
            if (primaryTarget && primaryTarget.position) {
                const direction = (primaryTarget.position.x > agent.position.x) ? 1 : -1;
                let destX = primaryTarget.position.x - (direction * 1);
                destX = Math.max(1, Math.min(CURRENT_BATTLEFIELD.MAX_X, destX));
                agent.position.x = destX;
                simLog(` -> Jumps to coordinates (${agent.position.x}, ${agent.position.y})`);
            }
            break;

        case 'REMOVE_CONDITION':
            if (primaryTarget.conditions.includes(action.condition)) {
                primaryTarget.conditions = primaryTarget.conditions.filter(c => c !== action.condition);
                simLog(` -> Removed condition '${action.condition}' from ${primaryTarget.name}.`);
            }
            break;

        case 'SPELLCAST_ROLL': {
            const traitMod = agent.traits[agent.spellcastTrait] || 0;
            const difficulty = action.difficulty || primaryTarget.difficulty;
            const actionName = context.actionInfo.name || context.card.name;
            simLog(` -> Casting \"${actionName}\": Making Spellcast Roll...`);
            const result = executeActionRoll(difficulty, traitMod, 0);
            simLog(` Roll: ${agent.spellcastTrait} (${traitMod}) | Total ${result.total} vs Diff ${difficulty} (${result.outcome})`);

            if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
                if (action.details.on_success) {
                    for (const successAction of action.details.on_success) {
                        executeParsedEffect(successAction, agent, primaryTarget, gameState, { rollResult: result, card: context.card, actionInfo: context.actionInfo });
                    }
                }
            } else {
                if (action.details.on_fail) {
                    for (const failAction of action.details.on_fail) {
                        executeParsedEffect(failAction, agent, primaryTarget, gameState, { rollResult: result, card: context.card, actionInfo: context.actionInfo });
                    }
                }
            }
            return result; 
        }
        case 'WEAPON_ATTACK': {
            simLog(` -> Using ${context.card.name}: Making Weapon Attack...`);
            const traitName = agent.primary_weapon.trait.toLowerCase();
            let traitMod = agent.traits[traitName];
            const difficulty = primaryTarget.difficulty;

            const combatState = getCombatState(agent, primaryTarget, gameState);
            if (combatState.hasAdvantage) traitMod += 2;
            if (combatState.hasDisadvantage) traitMod -= 2;

            const result = executeActionRoll(difficulty, traitMod, 0);
            simLog(` Roll: ${traitName} (${traitMod}) | Total ${result.total} vs Diff ${difficulty} (${result.outcome})`);

            if (result.outcome === 'CRITICAL_SUCCESS' || result.outcome === 'SUCCESS_WITH_HOPE' || result.outcome === 'SUCCESS_WITH_FEAR') {
                let damageString = agent.primary_weapon?.damage || "1d4";
                let proficiency = agent.proficiency;
                let critBonus = (result.outcome === 'CRITICAL_SUCCESS') ? parseDiceString(damageString).maxDie : 0;
                const damageTotal = rollDamage(damageString, proficiency, critBonus);
                const damageInfo = { amount: damageTotal, isDirect: false, isPhysical: true, isStandardAttack: true };
                applyDamage(damageInfo, agent, primaryTarget, gameState);

                if (action.details.on_success) {
                    for (const successAction of action.details.on_success) {
                        executeParsedEffect(successAction, agent, primaryTarget, gameState, { rollResult: result, card: context.card, actionInfo: context.actionInfo });
                    }
                }
                if (result.outcome === 'SUCCESS_WITH_HOPE' && action.details.on_success_with_hope) {
                    for (const hopeAction of action.details.on_success_with_hope) {
                        executeParsedEffect(hopeAction, agent, primaryTarget, gameState, { rollResult: result, card: context.card, actionInfo: context.actionInfo });
                    }
                }
                if (action.details.on_any_success) {
                    for (const anySuccessAction of action.details.on_any_success) {
                        executeParsedEffect(anySuccessAction, agent, primaryTarget, gameState, { rollResult: result, card: context.card, actionInfo: context.actionInfo });
                    }
                }
            }
            return result; 
        }

        case 'ATTACK_ROLL': {
            let hitCount = 0;
            for (const t of targets) {
                simLog(` Making an attack roll against ${t.name}...`);
                const reactions = evaluateTriggers(agent, "BEFORE_DEALING_DAMAGE", { target: t }, gameState);
                let damageBonus = reactions.damageBonus || 0;
                let takeSpotlight = reactions.takeSpotlight || false;

                const roll = rollD20();
                let modifier = agent.attack.modifier || 0;

                const combatState = getCombatState(agent, t, gameState);
                if (combatState.hasAdvantage) modifier += 2;
                if (combatState.hasDisadvantage) modifier -= 2;

                const totalAttack = roll + modifier;
                simLog(` Roll: 1d20(${roll}) + ${modifier} = ${totalAttack} vs Evasion ${t.evasion}`);

                if (totalAttack >= t.evasion) {
                    simLog(' HIT!');
                    hitCount++;

                    if (action.details.attack_type === 'standard') {
                        const damageString = agent.attack.damage;
                        const damageTotal = rollDamage(damageString, 1, 0) + damageBonus;
                        const isDirect = agent.passives.allAttacksAreDirect || false;
                        const damageInfo = { amount: damageTotal, isDirect: isDirect, isPhysical: (agent.attack.damage.includes('phy')), isStandardAttack: true };
                        applyDamage(damageInfo, agent, t, gameState);
                        evaluateTriggers(agent, "ON_SUCCESSFUL_ATTACK", damageInfo, gameState);
                    }

                    if (action.details.on_success) {
                        for (const successAction of action.details.on_success) {
                            if (successAction.action_type === 'DEAL_DAMAGE' && damageBonus > 0) {
                                successAction.bonus = damageBonus;
                            }
                            executeParsedEffect(successAction, agent, t, gameState, context);
                        }
                    }
                } else {
                    simLog(' MISS!');
                    if (action.details.on_fail) {
                        const onFailActions = Array.isArray(action.details.on_fail) ? action.details.on_fail : [action.details.on_fail];
                        for (const failAction of onFailActions) {
                            executeParsedEffect(failAction, agent, t, gameState, context);
                        }
                    }
                }
                if (takeSpotlight) simLog(` -> ${agent.name} takes the spotlight again! (Logic not implemented)`);
            }

            if (action.details.on_success_multi_target && hitCount >= 2) {
                executeParsedEffect(action.details.on_success_multi_target, agent, target, gameState, context);
            }
            break;
        }

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
                            executeParsedEffect(successAction, agent, t, gameState, context);
                        }
                    }
                } else {
                    simLog(` ${t.name} fails the Reaction Roll!`);
                    if (details.on_fail) {
                        const onFailActions = Array.isArray(details.on_fail) ? details.on_fail : [details.on_fail];
                        for (const failAction of onFailActions) {
                            executeParsedEffect(failAction, agent, t, gameState, context);
                        }
                    }
                }
            }
            break;

        case 'DEAL_DAMAGE': {
            let critBonus = 0;
            if (context.rollResult && context.rollResult.outcome === 'CRITICAL_SUCCESS') {
                 if (action.damage_string && action.damage_string.includes('d')) {
                     critBonus = parseDiceString(action.damage_string).maxDie;
                     simLog(` [CRIT] Applied +${critBonus} critical damage bonus to spell.`);
                 }
            }

            let damageTotal;
            let proficiency = agent.proficiency || 1;

            if (action.damage_string === 'half') {
                damageTotal = 1;
            } else if (action.damage_string.includes("stress") || action.damage_string.includes("HP")) {
                const parts = action.damage_string.split(' ');
                const value = parseInt(parts[0]) || 1;
                if (parts[1].toLowerCase() === 'stress') {
                    simLog(` Dealing ${value} DIRECT Stress!`);
                    primaryTarget.current_stress = Math.min(primaryTarget.max_stress, primaryTarget.current_stress + value);
                    simLog(` ${primaryTarget.name} Stress: ${primaryTarget.current_stress} / ${primaryTarget.max_stress}`);
                    return rollResult;
                } else {
                    damageTotal = value;
                }
            } else if (action.damage_string.includes('Xd')) { 
                const hopeSpent = context.actionInfo?.hopeSpent || 1;
                const damageString = action.damage_string.replace('X', hopeSpent);
                damageTotal = rollDamage(damageString, 1, critBonus); 
            } else {
                if (!action.use_proficiency) proficiency = 1;
                damageTotal = rollDamage(action.damage_string, proficiency, critBonus);
            }

            if (action.bonus_die) damageTotal += rollDamage(action.bonus_die, 1, 0);
            if (action.bonus_string === "Strength") damageTotal += (agent.traits?.strength || 0);

            if (agent.type !== 'player' && gameState.addD4Damage) {
                const bonusDamage = Math.floor(Math.random() * 4) + 1;
                damageTotal += bonusDamage;
                simLog(` -> (BP Mod) Adding +1d4 damage! (Rolled: ${bonusDamage})`);
            }
            if (action.bonus) damageTotal += action.bonus;

            const isDirect = (action.is_direct) || 
                             (agent.passives?.allAttacksAreDirect) || 
                             (agent.features?.some(f => f.parsed_effect?.passives?.some(p => p.mechanic === "DIRECT_DAMAGE")));

            if (damageTotal > 0) {
                simLog(` Dealing ${damageTotal} ${isDirect ? 'DIRECT' : ''} damage!`);
                const damageInfo = { 
                    amount: damageTotal, 
                    isDirect: isDirect, 
                    isPhysical: (action.damage_string.includes('phy')), 
                    isStandardAttack: false 
                };
                applyDamage(damageInfo, agent, primaryTarget, gameState);
            } else {
                simLog(` Damage roll was 0, no damage dealt.`);
            }
            break;
        }

        case 'HEAL_TARGET': {
            const healAmount = rollDamage(action.heal_string, 1, 0);
            const healType = (action.heal_string.includes("Stress")) ? "Stress" : "HP";
            simLog(` -> Healing ${primaryTarget.name} for ${healAmount} ${healType}`);
            if (healType === "HP") {
                primaryTarget.current_hp = Math.min(primaryTarget.max_hp, primaryTarget.current_hp + healAmount);
            } else {
                primaryTarget.current_stress = Math.max(0, primaryTarget.current_stress - healAmount);
            }
            break;
        }

        case 'DEAL_STRESS':
            const stressVal = action.value || 0;
            if (stressVal > 0) {
                simLog(` Dealing ${stressVal} DIRECT Stress!`);
                primaryTarget.current_stress = Math.min(primaryTarget.max_stress, primaryTarget.current_stress + stressVal);
                simLog(` ${primaryTarget.name} Stress: ${primaryTarget.current_stress} / ${primaryTarget.max_stress}`);
            }
            break;

        case 'APPLY_CONDITION':
            applyCondition(primaryTarget, action.condition);
            break;

        case 'CONDITIONAL_EFFECT': 
            executeParsedEffect(action.details, agent, primaryTarget, gameState, context);
            break;

        case 'MULTI_ACTION': 
            for (const subAction of action.actions) {
                executeParsedEffect(subAction, agent, primaryTarget, gameState, context);
            }
            break;

        case 'MOVE':
            simLog(` -> ${agent.name} is moving as part of an action...`);
            moveAgentTowards(agent, primaryTarget, gameState);
            break;

        case 'FORCE_MARK_ARMOR_SLOT':
            if (primaryTarget.current_armor_slots > 0) {
                primaryTarget.current_armor_slots--;
                simLog(` -> ${primaryTarget.name} is forced to mark 1 Armor Slot! (Slots left: ${primaryTarget.current_armor_slots})`);
            } else {
                simLog(` -> ${primaryTarget.name} has no Armor Slots to mark!`);
                if (action.on_fail) {
                    simLog(` -> Triggering 'on_fail' logic for failing to mark armor...`);
                    for (const failAction of action.on_fail.actions) {
                        executeParsedEffect(failAction, agent, primaryTarget, gameState, context);
                    }
                }
            }
            break;

        case 'CREATE_HAZARD':
            simLog(` -> ${agent.name} creates a Hazard in ${action.range} range!`);
            simLog(` -> ${action.details.hazard_effect}`);
            break;

        case 'NARRATIVE_EFFECT':
            simLog(` -> ${agent.name} uses ${action.description}`);
            break;

        case 'TAKE_SPOTLIGHT':
            simLog(` -> ${agent.name} takes the spotlight! (Effect not fully implemented)`);
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
            if (primaryTarget.position.x < agent.position.x) {
                primaryTarget.position.x = Math.max(1, primaryTarget.position.x - 2);
            } else {
                primaryTarget.position.x = Math.min(CURRENT_BATTLEFIELD.MAX_X, primaryTarget.position.x + 2);
            }
            simLog(` -> ${primaryTarget.name} lands at (${primaryTarget.position.x}, ${primaryTarget.position.y})`);
            break;

        case 'PULL':
            const pullRange = action.range || 'Melee';
            simLog(` -> ${primaryTarget.name} is pulled into ${pullRange} range!`);
            primaryTarget.position.x = Math.max(1, agent.position.x - 1);
            primaryTarget.position.y = agent.position.y;
            simLog(` -> ${primaryTarget.name} lands at (${primaryTarget.position.x}, ${primaryTarget.position.y})`);
            break;

        case 'MODIFY_DAMAGE':
            simLog(` -> (MODIFY_DAMAGE action noted, but logic is handled by reaction.)`);
            break;

        case 'REDUCE_SEVERITY':
            if (context.damageEvent) {
                simLog(` -> Effect reduces severity by ${action.value}!`);
                context.damageEvent.hpToMark = Math.max(0, context.damageEvent.hpToMark - action.value);
            }
            break;

        case 'HALVE_DAMAGE':
            if (context.damageEvent) {
                simLog(` -> Effect halves incoming damage!`);
                context.damageEvent.amount = Math.floor(context.damageEvent.amount / 2);
            }
            break;

        case 'INTERCEPT_DAMAGE':
            if (context.damageEvent) {
                simLog(` -> ${agent.name} intercepts the damage!`);
                context.damageEvent.intercepted = true;
                context.damageEvent.newTarget = agent;
            }
            break;

        case 'APPLY_BUFF':
            if (!agent.buffs) agent.buffs = [];
            agent.buffs.push({
                name: action.buff,
                value: action.value,
                duration: action.duration,
                source: context.card?.name || "Feature"
            });
            simLog(` -> Applied Buff: ${action.buff} (+${action.value}) to ${agent.name}`);
            break;

        case 'APPLY_CONDITION':
            applyCondition(primaryTarget, action.condition);
            break;

        case 'CHOICE':
            if (action.options && action.options.length > 0) {
                const choice = action.options[0];
                simLog(` -> AI Chooses Option: ${choice.name || choice.description}`);
                if (choice.action_type === 'APPLY_PASSIVE_EFFECT') {
                    if (!agent.active_modes) agent.active_modes = [];
                    agent.active_modes.push(choice);
                    simLog(` -> Entered Mode: ${choice.condition}`);
                } else {
                    executeParsedEffect(choice, agent, primaryTarget, gameState, context);
                }
            }
            break;

        case 'GRANT_RESOURCE_DIE':
            if (action.target === 'ALL_ALLIES_AND_SELF') {
                gameState.players.forEach(p => {
                    if (p.current_hp > 0) {
                        p.resources = p.resources || {};
                        p.resources[action.resource_id] = (p.resources[action.resource_id] || 0) + 1;
                        simLog(` -> ${p.name} gained a ${action.resource_id}`);
                    }
                });
            }
            break;

        case 'MODIFY_STAT':
            if (action.duration) {
                if (!agent.buffs) agent.buffs = [];
                agent.buffs.push({ stat: action.details.stat, value: action.details.value, duration: action.duration });
            }
            break;
        default:
            simLog(` (Logic for action_type '${action.action_type}' not yet implemented.)`);
    }
    return rollResult; 
}

function applyCondition(target, condition) {
    if (!target.conditions.includes(condition)) {
        target.conditions.push(condition);
        simLog(` ${target.name} is now ${condition}!`);
    }
}


function processRollResources(result, gameState, player) {
    switch (result.outcome) {
        case 'CRITICAL_SUCCESS':
            player.current_hope = Math.min(player.max_hope, player.current_hope + 1);
            player.current_stress = Math.max(0, player.current_stress - 1);
            simLog(` Resource: ${player.name} gains +1 Hope (Total: ${player.current_hope}), clears 1 Stress (Total: ${player.current_stress}).`);
            break;
        case 'SUCCESS_WITH_HOPE':
            player.current_hope = Math.min(player.max_hope, player.current_hope + 1);
            simLog(` Resource: ${player.name} gains +1 Hope (Total: ${player.current_hope})`);
            break;
        case 'FAILURE_WITH_HOPE':
            player.current_hope = Math.min(player.max_hope, player.current_hope + 1);
            simLog(` Resource: ${player.name} gains +1 Hope (Total: ${player.current_hope})`);
            break;
        case 'SUCCESS_WITH_FEAR':
            gameState.fear = Math.min(12, gameState.fear + 1);
            simLog(` Resource: +1 Fear (Total: ${gameState.fear})`);
            break;
        case 'FAILURE_WITH_FEAR':
            gameState.fear = Math.min(12, gameState.fear + 1);
            simLog(` Resource: +1 Fear (Total: ${gameState.fear})`);
            break;
    }
}

// --- PRE-CALCULATION HOOK (Step A) ---
function evaluateDamageModifiers(attacker, target, damageAmount, type, gameState) {
    // This iterates through reactions like 'Increased Fortitude' (HALVE_DAMAGE) that modify raw amounts
    const context = {
        amount: damageAmount,
        type: type,
        damageEvent: { amount: damageAmount, hpToMark: 0 }, // Mock damageEvent for handlers
        originalTarget: target
    };
    
    // Execute triggers on the target to modify the incoming damage amount
    evaluateTriggers(target, 'ON_TAKE_DAMAGE', context, gameState);
    
    // Return the modified amount
    return context.damageEvent.amount;
}

function applyDamage(damageInfo, attacker, target, gameState) {
    // 1. SETUP CONTEXT
    let dmgContext = { 
        amount: damageInfo.amount, 
        type: damageInfo.isPhysical ? 'physical' : 'magic',
        isDirect: damageInfo.isDirect, 
        isStandardAttack: damageInfo.isStandardAttack,
        hpToMark: 0, 
        attacker: attacker, 
        originalTarget: target,
        intercepted: false,
        newTarget: null
    };
    simLog(` Damage Event: ${dmgContext.amount} (${dmgContext.type}) vs ${target.name}`);

    // 2. INTERCEPTION (Step 0)
    gameState.players.forEach(ally => {
        if (ally.id !== target.id && ally.current_hp > 0 && getAgentDistance(ally, target) <= 1) {
            evaluateTriggers(ally, 'ON_ALLY_TAKE_DAMAGE', dmgContext, gameState);
        }
    });

    let activeTarget = target;
    if (dmgContext.intercepted && dmgContext.newTarget) {
        activeTarget = dmgContext.newTarget;
        simLog(` -> Damage redirected to ${activeTarget.name}!`);
    }

    // 3. DAMAGE MITIGATION (Step 2 - ON_TAKE_DAMAGE)
    // Only run if damage > 0. Handles Halve/Reduce Damage.
    if (dmgContext.amount > 0) {
        dmgContext.amount = evaluateDamageModifiers(attacker, activeTarget, dmgContext.amount, dmgContext.type, gameState);
    }

    // 4. SEVERITY CALCULATION (Step 3 & 5)
    const thresholds = activeTarget.thresholds || { minor: 1, major: 6, severe: 12 };
    if (dmgContext.amount >= thresholds.severe) dmgContext.hpToMark = 3;
    else if (dmgContext.amount >= thresholds.major) dmgContext.hpToMark = 2;
    else if (dmgContext.amount >= (thresholds.minor || 1)) dmgContext.hpToMark = 1;
    else dmgContext.hpToMark = 0;

    simLog(` -> Severity Calculation: ${dmgContext.hpToMark} HP`);

    // 5. HP MITIGATION (Step 6 - ON_TAKE_SEVERITY)
    // Handles Thick Skin, Armor. Only run if there is HP to mark.
    if (dmgContext.hpToMark > 0) {
        let severityContext = { 
            hpToMark: dmgContext.hpToMark, 
            amount: dmgContext.amount, 
            type: dmgContext.type, 
            originalTarget: activeTarget 
        };
        // Execute Triggers (Modifies severityContext.hpToMark)
        evaluateTriggers(activeTarget, 'ON_TAKE_SEVERITY', severityContext, gameState);
        dmgContext.hpToMark = severityContext.hpToMark;
    }

    // 6. FINAL APPLICATION
    if (dmgContext.hpToMark > 0) {
         // Armor Slot deduction logic
         if (activeTarget.current_armor_slots > 0 && !dmgContext.isDirect) {
             activeTarget.current_armor_slots--;
             dmgContext.hpToMark = Math.max(0, dmgContext.hpToMark - 1);
             simLog(` -> Marks Armor. HP: ${dmgContext.hpToMark}`);
         }

         if (dmgContext.hpToMark > 0) {
             activeTarget.current_hp -= dmgContext.hpToMark;
             simLog(` -> Marks ${dmgContext.hpToMark} HP. (Current: ${activeTarget.current_hp})`);
             
             // ON_DEAL_HP triggers
             if (attacker) {
                evaluateTriggers(attacker, 'ON_DEAL_HP_DAMAGE', { hpMarked: dmgContext.hpToMark }, gameState);
                if (attacker.type === 'adversary') {
                     evaluateTriggers(attacker, "ON_DEAL_HP", { hpMarked: dmgContext.hpToMark, target: activeTarget }, gameState);
                     
                     if (dmgContext.isStandardAttack && attacker.passives?.knockbackOnHP) {
                         simLog(` -> ${attacker.name}'s PASSIVE triggers: Overwhelming Force!`);
                         const knockbackEffect = { action_type: 'KNOCKBACK', range: attacker.passives.knockbackOnHP.range, is_direct: false };
                         executeParsedEffect(knockbackEffect, attacker, activeTarget, gameState);
                    }
                }
            }
         }
    }

    if (activeTarget.current_hp <= 0) {
        simLog(` *** ${activeTarget.name} is Defeated! ***`);
        evaluateTriggers(activeTarget, 'ON_DEFEAT', {}, gameState);
    }
}

function checkForPCReactions(damageTotal, attacker, target, isDirectDamage, gameState) {
    for (const potentialProtector of gameState.players) {
        if (potentialProtector.current_hp <= 0 || potentialProtector.id === target.id) {
            continue;
        }

        if (potentialProtector.class === "Guardian") {
            const shieldCard = potentialProtector.domainCards.find(c => c.name === "I Am Your Shield");
            if (shieldCard) {
                if (potentialProtector.current_stress < potentialProtector.max_stress) {
                    if (isTargetInRange(potentialProtector, target, "Very Close")) {
                        potentialProtector.current_stress += 1;
                        simLog(` -> ${potentialProtector.name} uses "I Am Your Shield"!`);
                        simLog(` -> ${potentialProtector.name} marks 1 Stress (Total: ${potentialProtector.current_stress})`);
                        return potentialProtector;
                    }
                }
            }
        }
    }

    return null;
}

// --- EVENT & TRIGGER SYSTEM ---

function evaluateTriggers(agent, triggerName, context, gameState) {
    const resultContext = { damageBonus: 0, takeSpotlight: false, eventCancelled: false };
    if (!agent.features) return resultContext;

    // 1. Collect Candidates with Strict Filter
    const rawCandidates = agent.features ? [...agent.features] : [];
    if (agent.domainCards) rawCandidates.push(...agent.domainCards.map(c => ({...c, ...c.parsed_effect})));
    
    // Check Active Conditions from Library
    if (agent.conditions && typeof CONDITION_LIBRARY !== 'undefined') {
        agent.conditions.forEach(condName => {
            const condDef = CONDITION_LIBRARY[condName];
            if (condDef && condDef.parsed_effect && condDef.parsed_effect.passives) {
                condDef.parsed_effect.passives.forEach(passive => {
                    // Push formatted object for filtering
                    rawCandidates.push({
                        name: `Condition: ${condName}`,
                        parsed_effect: { actions: [passive], trigger: passive.trigger },
                        trigger: passive.trigger,
                        cost: null
                    });
                });
            }
        });
    }

    const candidates = rawCandidates.filter(f => {
        // Priority 1: Top-level trigger MUST match if present
        if (f.trigger) return f.trigger === triggerName;
        // Priority 2: Fallback to parsed_effect trigger
        if (f.parsed_effect && f.parsed_effect.trigger) return f.parsed_effect.trigger === triggerName;
        return false;
    });

    // 2. Process Candidates
    for (const feat of candidates) {
        
        // Phase Guard
        if (triggerName === 'ON_TAKE_DAMAGE') {
             const effects = feat.parsed_effect?.actions || [];
             const isDamageMod = effects.some(a => ['HALVE_DAMAGE', 'REDUCE_DAMAGE', 'MODIFY_DAMAGE'].includes(a.action_type));
             if (!isDamageMod && feat.trigger !== 'ON_TAKE_DAMAGE') continue;
        }
        if (triggerName === 'ON_TAKE_SEVERITY') {
             const effects = feat.parsed_effect?.actions || [];
             const isSeverityMod = effects.some(a => ['PREVENT_HP_MARK', 'REDUCE_SEVERITY'].includes(a.action_type));
             if (!isSeverityMod && feat.trigger !== 'ON_TAKE_SEVERITY') continue;
        }

        // FACTION CHECK: Prevent protecting enemies
        if (feat.trigger === 'ON_ALLY_TAKE_DAMAGE' || feat.target === 'ALLY' || feat.target === 'ALLY_TARGET') {
            if (context.originalTarget && agent.type !== context.originalTarget.type) {
                // Abort if Faction Mismatch (e.g. Player protecting Adversary)
                continue;
            }
        }

        // Check Criteria 
        if (!checkTriggerCriteria(feat, context)) continue;

        // Smart Reaction Logic (AI Utility Check)
        if (feat.parsed_effect) {
            const actions = feat.parsed_effect.actions || [];
            
            // 1. Damage Reduction Utility
            if (actions.some(a => a.action_type === 'HALVE_DAMAGE' || a.action_type === 'REDUCE_DAMAGE')) {
                 if (context.amount !== undefined && agent.thresholds) {
                      const currentDmg = context.amount;
                      const reactionAction = actions.find(a => a.action_type === 'HALVE_DAMAGE' || a.action_type === 'REDUCE_DAMAGE');
                      const reducedDmg = (reactionAction.action_type === 'HALVE_DAMAGE') ? Math.floor(currentDmg / 2) : Math.max(0, currentDmg - (reactionAction.value || 0));
                      
                      const getSeverity = (dmg, t) => { 
                          if(dmg >= t.severe) return 3; 
                          if(dmg >= t.major) return 2; 
                          if(dmg >= (t.minor||1)) return 1; 
                          return 0; 
                      };
                      
                      if (getSeverity(currentDmg, agent.thresholds) === getSeverity(reducedDmg, agent.thresholds)) {
                          simLog(` -> AI Skipped ${feat.name}: Reduction wouldn't change severity.`);
                          continue; 
                      }
                 }
            }

            // 2. Severity Mitigation Utility (Thick Skin)
            if (actions.some(a => a.action_type === 'PREVENT_HP_MARK')) {
                if (context.hpToMark !== undefined) {
                    if (context.hpToMark <= 0) {
                        simLog(` -> AI Skipped ${feat.name}: No HP to mitigate.`);
                        continue;
                    }
                }
            }
        }

        // Check & Pay Cost 
        if (!checkAndPayCost(agent, feat.cost)) {
            continue; 
        }

        simLog(` -> Triggered: ${feat.name} (${agent.name})`);
        
        // Execute
        if (feat.parsed_effect && feat.parsed_effect.actions) {
            for (const action of feat.parsed_effect.actions) {
                
                if (action.action_type === 'MODIFY_DAMAGE') {
                     const bonus = action.details?.bonus || 0;
                     resultContext.damageBonus += bonus;
                     simLog(` -> Added +${bonus} damage.`);
                } 
                else if (action.action_type === 'TAKE_SPOTLIGHT') {
                    resultContext.takeSpotlight = true;
                    simLog(` -> Triggered Spotlight seize.`);
                } 
                else {
                    executeParsedEffect(action, agent, context.originalTarget || agent, gameState, context);
                }
            }
        }
    }
    return resultContext;
}

function checkTriggerCriteria(feature, context) {
    const criteria = feature.trigger_criteria || (feature.parsed_effect && feature.parsed_effect.trigger_criteria);
    if (!criteria) return true; 

    if (criteria.damage_type && context.type !== criteria.damage_type) return false;
    
    // Strict Severity Check
    if (criteria.exact_severity !== undefined) {
        if (context.hpToMark !== criteria.exact_severity) return false;
    }

    // Standard Threshold logic ("Major or Higher")
    if (criteria.threshold) {
        if (criteria.threshold === "MINOR" && context.hpToMark < 1) return false;
        if (criteria.threshold === "MAJOR" && context.hpToMark < 2) return false;
        if (criteria.threshold === "SEVERE" && context.hpToMark < 3) return false;
    }
    
    return true;
}

function checkAndPayCost(agent, cost) {
    if (!cost) return true;

    if (cost.type === 'stress') {
        if (agent.current_stress + cost.value <= agent.max_stress) {
            agent.current_stress += cost.value;
            simLog(` -> Paid Cost: ${cost.value} Stress`);
            return true;
        }
    } else if (cost.type === 'hope') {
        if (agent.current_hope >= cost.value) {
            agent.current_hope -= cost.value;
            simLog(` -> Paid Cost: ${cost.value} Hope`);
            return true;
        }
    } else if (cost.type === 'armor_slot') {
        if (agent.current_armor_slots >= cost.value) {
            agent.current_armor_slots -= cost.value;
            simLog(` -> Paid Cost: ${cost.value} Armor Slot`);
            return true;
        }
    }
    
    return false;
}