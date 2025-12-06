// --- ADVERSARY ENGINE ---
// Handles adversary decision making, targeting, and action execution.

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

function performAdversaryAction(adversary, target, gameState) {
    simLog(` Spotlight is on: ${adversary.name} (targeting ${target.name} at (${target.position.x}, ${target.position.y}))...`, 'log-adversary');

    // Safety check: ensure features exists
    const allActions = (adversary.features || []).filter(f => f.type === 'action' && f.parsed_effect);

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
            let priorityA = 0;
            let priorityB = 0;
            
            // Base Priority from Cost
            if (a.cost?.type === 'fear') priorityA = 3;
            else if (a.cost?.type === 'stress') priorityA = 2;
            else priorityA = 1;
            
            if (b.cost?.type === 'fear') priorityB = 3;
            else if (b.cost?.type === 'stress') priorityB = 2;
            else priorityB = 1;

            // Redundancy Check: Penalize if target already has the condition
            const aEffect = a.parsed_effect.actions[0];
            if (aEffect && aEffect.action_type === 'APPLY_CONDITION' && target.conditions.includes(aEffect.condition)) {
                priorityA -= 10; // Massive penalty
            }
            
            const bEffect = b.parsed_effect.actions[0];
            if (bEffect && bEffect.action_type === 'APPLY_CONDITION' && target.conditions.includes(bEffect.condition)) {
                priorityB -= 10; // Massive penalty
            }

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
            simLog(` -> No features available. Target is in ${weaponRange} range. Defaulting to basic attack.`);
            executeGMBasicAttack(adversary, target, gameState);
        } else {
            // UPDATED: Capability Check for Movement (Restrained)
            const capContext = { movementPrevented: false };
            evaluateTriggers(adversary, 'CHECK_CAPABILITIES', capContext, gameState);
            
            if (capContext.movementPrevented) {
                simLog(` -> ${adversary.name} wants to move/sprint, but is prevented (Restrained)!`);
            } else {
                simLog(` -> No features available. Target is out of ${weaponRange} range. Sprinting closer.`);
                moveAgentTowards(adversary, target, gameState, true); // true = isSprint
            }
        }
    }
}

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
        
        // UPDATED: Use evaluateTriggers instead of checkAdversaryReactions
        const triggerContext = evaluateTriggers(adversary, "BEFORE_DEALING_DAMAGE", { target: currentTarget }, gameState);
        damageBonus = triggerContext.damageBonus;
        takeSpotlight = triggerContext.takeSpotlight;

        const roll = rollD20();
        let modifier = adversary.attack.modifier || 0;

        // UPDATED: Use Unified State Check
        const combatState = getCombatState(adversary, currentTarget, gameState);
        if (combatState.hasAdvantage) {
            modifier += 2;
            simLog(` (Adversary has Advantage!)`);
        }
        if (combatState.hasDisadvantage) {
            modifier -= 2;
            simLog(` (Adversary has Disadvantage!)`);
        }

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
            let damageTotal = rollDamage(damageString, 1, critBonus) + damageBonus;
            if (gameState.addD4Damage) {
                const bonusDamage = Math.floor(Math.random() * 4) + 1;
                damageTotal += bonusDamage;
                simLog(` -> (BP Mod) Adding +1d4 damage! (Rolled: ${bonusDamage})`);
            }

            const isDirect = adversary.passives.allAttacksAreDirect || false;

            const damageInfo = {
                amount: damageTotal,
                isDirect: isDirect,
                isPhysical: (adversary.attack.damage.includes('phy')),
                isStandardAttack: true
            };
            applyDamage(damageInfo, adversary, currentTarget, gameState);

            // UPDATED: Use evaluateTriggers
            evaluateTriggers(adversary, "ON_SUCCESSFUL_ATTACK", { target: currentTarget, ...damageInfo }, gameState);

        } else {
            simLog('  MISS!');
        }

        if (takeSpotlight) {
            simLog(` -> ${adversary.name} takes the spotlight again! (Logic not implemented)`);
        }
    }
}