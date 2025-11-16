// --- SPOTLIGHT SIMULATION ENGINE ---
async function runMultipleSimulations(count) {
    printToLog(`\n===== STARTING BATCH OF ${count} SIMULATION(S) =====`);
    
    simHistory = [];
    const playbackBtn = document.getElementById('playback-button');
    if (playbackBtn) {
        playbackBtn.disabled = true;
    }

    for (let i = 1; i <= count; i++) {
        // Run the simulation synchronously.
        runSimulation(count); 
        
        // "Breathe" to prevent freezing after a very fast synchronous run
        if (count > 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    printToLog(`\n===== BATCH COMPLETE =====`);
    
    if (count === 1 && simHistory.length === 1 && simHistory[0].playbackLog) {
        if (playbackBtn) {
            playbackBtn.disabled = false;
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

function runSimulation(count) {
    const recordPlayback = (count === 1); 
    BATCH_LOG = []; // Always reset the log for a new sim

    simLog('======================================');
    simLog('INITIALIZING NEW SIMULATION...');
    simLog('======================================');

    const mapSize = document.getElementById('map-size-select').value;
    
    CURRENT_BATTLEFIELD = {
        ...DAGGERHEART_RANGES,
        ...MAP_CONFIGS[mapSize] 
    };

    simLog(`Simulating on ${mapSize} map (${CURRENT_BATTLEFIELD.MAX_X}x${CURRENT_BATTLEFIELD.MAX_Y})...`);

    // NEW: Get active environment difficulty
    const sceneDifficulty = activeEnvironment ? activeEnvironment.difficulty : 10;
    simLog(`Active Environment Difficulty set to: ${sceneDifficulty}`);


    if (activeParty.length === 0) { 
        simLog('--- ERROR --- \nAdd a player to the Active Scene.');
        printToLog(BATCH_LOG.join('\n'));
        BATCH_LOG = [];
        return; 
    }
    if (activeAdversaries.length === 0) { 
        simLog('--- ERROR --- \nAdd an adversary to the Active Scene.'); 
        printToLog(BATCH_LOG.join('\n'));
        BATCH_LOG = [];
        return; 
    }

    let playerAgents, adversaryAgents;
    try {
        playerAgents = activeParty.map(instantiatePlayerAgent);
        adversaryAgents = activeAdversaries.map(instantiateAdversaryAgent);
    } catch (e) {
        simLog(`--- ERROR --- \nFailed to parse agent JSON. \n${e.message}`);
        console.error("Error during instantiation:", e);
        printToLog(BATCH_LOG.join('\n'));
        BATCH_LOG = [];
        return; 
    }

    let currentPlaybackLog = [];
    const startTime = Date.now();

    const gameState = {
        players: playerAgents,
        adversaries: adversaryAgents,
        hope: 2 * playerAgents.length,
        fear: 1 * playerAgents.length,
        spotlight: 0,
        lastPlayerSpotlight: 0,
        sceneDifficulty: sceneDifficulty // NEW
    };

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
         simLog(`--- SIMULATION HALTED --- \nReached max round limit (100). Combat may be in an infinite loop.`);
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
        winner: winner,
        rounds: roundCounter,
        duration: duration,
        players: gameState.players.map(p => ({ name: p.name, hp: p.current_hp, stress: p.current_stress })),
        adversaries: gameState.adversaries.map(a => ({ name: a.name, hp: a.current_hp, stress: a.current_stress })),
        playbackLog: currentPlaybackLog.length > 0 ? currentPlaybackLog : null
    });
    
    const finalLogText = BATCH_LOG.join('\n');
    BATCH_LOG = []; // Clear log for next run
    
    printToLog(finalLogText); // Print the full play-by-play
    printToLog(scoreboard, winnerClass); // Print the color-coded scoreboard
}

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


function recordSnapshot(gameState, playbackLog) {
    const snapshot = {
        players: gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            current_hp: p.current_hp,
            position: { ...p.position }
        })),
        adversaries: gameState.adversaries.map(a => ({
            id: a.id,
            name: a.name,
            current_hp: a.current_hp,
            position: { ...a.position }
        }))
    };
    playbackLog.push(snapshot);
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
        simLog(` -> ${target.name} is out of range of all options. Moving closer (Agility Roll).`);
        // NEW: This is a "Sprint" action and must use scene difficulty
        moveAgentTowards(player, target, gameState, true); // true = isSprint
        
        simLog(` -> Making Agility roll to move...`);
        result = executeActionRoll(gameState.sceneDifficulty, player.traits.agility || 0, 0); 
        simLog(` Roll: agility (${player.traits.agility || 0}) | Total ${result.total} vs Diff ${gameState.sceneDifficulty} (${result.outcome})`);
    }
    
    processRollResources(result, gameState, player);
    return result.outcome;
}

function choosePCAction(player, target, gameState) {
    let possibleActions = [];

    for (const card of player.domainCards) {
        switch (card.name) {
            case "Vicious Entangle":
                if (isTargetInRange(player, target, "Far")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 1, name: "Vicious Entangle" });
                }
                break;
            case "Bolt Beacon":
                if (player.current_hope >= 1 && isTargetInRange(player, target, "Far")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 1, name: "Bolt Beacon" });
                }
                break;
            case "Book Of Illiat":
                if (isTargetInRange(player, target, "Very Close")) {
                    possibleActions.push({ type: 'SPELL', card: card, priority: 2, name: "Slumber" });
                }
                break;
        }
    }

    const weaponRange = player.primary_weapon.range;
    if (isTargetInRange(player, target, weaponRange)) {
        possibleActions.push({ type: 'ATTACK', priority: 0, name: `Basic Attack (${player.primary_weapon.name})` });
    }

    if (possibleActions.length === 0) {
        return null;
    }

    possibleActions.sort((a, b) => b.priority - a.priority);
    
    simLog(` -> ${player.name} considered: [${possibleActions.map(a => a.name).join(', ')}]`);
    
    const bestAction = possibleActions[0];
    simLog(` -> Decided on: ${bestAction.name}`);
    return bestAction;
}

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
    simLog(` Spotlight is on: ${adversary.name} (targeting ${target.name} at (${target.position.x}, ${target.position.y}))...`);

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
            let priorityA = 0;
            let priorityB = 0;
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
            simLog(` -> No features available. Target is in ${weaponRange} range. Defaulting to basic attack.`);
            executeGMBasicAttack(adversary, target, gameState);
        } else {
            // NEW: This is now a "Sprint" action
            simLog(` -> No features available. Target is out of ${weaponRange} range. Sprinting closer.`);
            moveAgentTowards(adversary, target, gameState, true); // true = isSprint
        }
    }
}

// --- ADVERSARY BRAIN LEXICON ---
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
                if (reactionResult.damageBonus) {
                    damageBonus = reactionResult.damageBonus;
                }
                if (reactionResult.takeSpotlight) {
                    takeSpotlight = true;
                }
                
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
                        const damageInfo = { 
                            amount: damageTotal, 
                            isDirect: isDirect, 
                            isPhysical: (adversary.attack.damage.includes('phy')),
                            isStandardAttack: true
                        };
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
                const damageInfo = {
                    amount: damageTotal,
                    isDirect: isDirect,
                    isPhysical: (action.damage_string.includes('phy')),
                    isStandardAttack: false
                };
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
                    } else {
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

function applyCondition(target, condition) {
    if (!target.conditions.includes(condition)) {
        target.conditions.push(condition);
        simLog(` ${target.name} is now ${condition}!`);
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
        const reactionResult = checkAdversaryReactions("BEFORE_DEALING_DAMAGE", adversary, currentTarget, gameState);
        if (reactionResult.damageBonus) {
            damageBonus = reactionResult.damageBonus;
        }
        if (reactionResult.takeSpotlight) {
            takeSpotlight = true;
        }

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
            
            const damageInfo = { 
                amount: damageTotal, 
                isDirect: isDirect, 
                isPhysical: (adversary.attack.damage.includes('phy')),
                isStandardAttack: true
            };
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

function checkForPCDamageReactions(player, hpToMark, gameState) {
    if (player.class === "Guardian" && hpToMark === 3) {
        const getBackUpCard = player.domainCards.find(c => c.name === "Get Back Up");
        if (getBackUpCard && player.current_stress < player.max_stress) {
            player.current_stress++;
            simLog(` -> ${player.name} uses "Get Back Up"!`);
            simLog(` -> ${player.name} marks 1 Stress (Total: ${player.current_stress})`);
            return true;
        }
    }
    
    return false;
}

function checkAdversaryReactions(trigger, agent, target, gameState, damageInfo = {}) {
    if (!agent.features) return { damageBonus: 0, takeSpotlight: false };
    if (agent.current_hp <= 0 && trigger !== "ON_DEFEAT") return { damageBonus: 0, takeSpotlight: false }; 

    let reactionBonus = 0;
    let reactionSpotlight = false;

    for (const feature of agent.features) {
        if (feature.type !== 'reaction' || !feature.parsed_effect) continue;

        for (const action of feature.parsed_effect.actions) {
            if (action.trigger === trigger) {
                
                if (trigger === "ON_TAKE_DAMAGE") {
                    const hpThreshold = (action.trigger_details?.match(/(\d+)_HP_OR_MORE/) || [])[1];
                    if (hpThreshold && damageInfo.hpMarked < parseInt(hpThreshold)) {
                        continue;
                    }
                }

                if (action.cost) {
                    if (action.cost.type === 'stress') {
                        if (agent.current_stress < agent.max_stress) {
                            agent.current_stress += action.cost.value;
                            simLog(` -> ${agent.name} marks ${action.cost.value} Stress for ${feature.name} (Total: ${agent.current_stress})`);
                        } else {
                            simLog(` -> ${agent.name} cannot afford Stress for ${feature.name}.`);
                            continue;
                        }
                    }
                }
                
                simLog(` -> ${agent.name}'s REACTION triggers: ${feature.name}!`);

                if (trigger === "BEFORE_DEALING_DAMAGE") {
                    if (action.action_type === 'MODIFY_DAMAGE') {
                        reactionBonus += action.details.bonus || 0;
                    }
                    if (action.action_type === 'TAKE_SPOTLIGHT') {
                        reactionSpotlight = true;
                    }
                } else {
                    executeParsedEffect(action, agent, target, gameState);
                }
            }
        }
    }
    
    return { damageBonus: reactionBonus, takeSpotlight: reactionSpotlight };
}


function processRollResources(result, gameState, player) {
    switch (result.outcome) {
        case 'CRITICAL_SUCCESS':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1);
            player.current_stress = Math.max(0, player.current_stress - 1); 
            simLog(` Resource: +1 Hope (Total: ${gameState.hope}), ${player.name} clears 1 Stress.`);
            break;
        case 'SUCCESS_WITH_HOPE':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1);
            simLog(` Resource: +1 Hope (Total: ${gameState.hope})`);
            break;
        case 'FAILURE_WITH_HOPE':
            gameState.hope = Math.min(player.max_hope, gameState.hope + 1);
            simLog(` Resource: +1 Hope (Total: ${gameState.hope})`);
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

function applyDamage(damageInfo, attacker, target, gameState) {
    
    let finalTarget = target;
    let isIntercepted = false;
    let { amount, isDirect, isPhysical, isStandardAttack } = damageInfo;

    if (gameState && target.type === 'player') { 
        const interceptingPlayer = checkForPCReactions(amount, attacker, target, isDirect, gameState);
        if (interceptingPlayer) {
            finalTarget = interceptingPlayer; 
            isIntercepted = true;
        }
    }

    let hpToMark = 0;
    let isMajor = false;
    let isSevere = false;
    
    // --- BUG FIX: Check if thresholds object and properties exist ---
    const majorThreshold = finalTarget.thresholds?.major;
    const severeThreshold = finalTarget.thresholds?.severe;

    if (!majorThreshold || !severeThreshold) {
        simLog(` (WARNING: Target ${finalTarget.name} has N/A thresholds! Defaulting to 1 HP.)`);
        if (amount > 0) hpToMark = 1; 
    } else {
        if (amount >= severeThreshold) {
            hpToMark = 3;
            isSevere = true;
            isMajor = true;
        } else if (amount >= majorThreshold) {
            hpToMark = 2;
            isMajor = true;
        } else if (amount > 0) {
            hpToMark = 1;
        }
    }
    
    if (finalTarget.type === 'adversary' && finalTarget.passives.takeExtraPhysicalHP && isPhysical && hpToMark > 0) {
        simLog(` -> ${finalTarget.name}'s 'Weak Structure' passive applies!`);
        hpToMark += finalTarget.passives.takeExtraPhysicalHP;
    }

    let originalHPMark = hpToMark;
    simLog(` Damage: ${amount} (dealt by ${attacker.name}) vs ${finalTarget.name}'s Thresholds (${majorThreshold || 'N/A'}/${severeThreshold || 'N/A'})`);
    simLog(` Calculated Severity: ${originalHPMark} HP`);
    
    if (finalTarget.type === 'player' && hpToMark > 0) {
        const severityReduced = checkForPCDamageReactions(finalTarget, hpToMark, gameState);
        if (severityReduced) {
            hpToMark--;
            simLog(` -> Severity reduced by reaction! New HP to mark: ${hpToMark}`);
            if (originalHPMark === 3) isSevere = false;
            if (originalHPMark === 2 && hpToMark < 2) isMajor = false;
        }
    }

    if (isIntercepted && finalTarget.class === "Guardian") {
        simLog(` -> Guardian "I Am Your Shield" applies!`);
        while (hpToMark > 0 && finalTarget.current_armor_slots > 0) {
            finalTarget.current_armor_slots--;
            hpToMark--;
            simLog(` ${finalTarget.name} marks 1 Armor Slot! (Slots left: ${finalTarget.current_armor_slots})`);
        }
    } 
    else if (finalTarget.type === 'player' && finalTarget.current_armor_slots > 0 && hpToMark > 0 && !isDirect) {
        finalTarget.current_armor_slots--;
        hpToMark--;
        simLog(` ${finalTarget.name} marks 1 Armor Slot! (Slots left: ${finalTarget.current_armor_slots})`);
    } else if (isDirect && finalTarget.type === 'player') {
        simLog(` This is DIRECT damage and cannot be mitigated by armor!`);
    }

    finalTarget.current_hp -= hpToMark;
    
    if (originalHPMark > hpToMark) {
        simLog(` Final HP marked: ${hpToMark}.`);
    } else if (originalHPMark > 0) {
        simLog(` Final HP marked: ${hpToMark}.`);
    }
    
    simLog(` ${finalTarget.name} HP: ${finalTarget.current_hp} / ${finalTarget.max_hp}`);
    
    const damageEventInfo = {
        amount: amount,
        hpMarked: hpToMark,
        isMajor: isMajor,
        isSevere: isSevere,
        isPhysical: isPhysical,
        isStandardAttack: isStandardAttack
    };

    if (finalTarget.type === 'adversary') {
        checkAdversaryReactions("ON_TAKE_DAMAGE", finalTarget, attacker, gameState, damageEventInfo);
        
        if (damageEventInfo.isSevere) {
            checkAdversaryReactions("ON_TAKE_SEVERE_DAMAGE", finalTarget, attacker, gameState, damageEventInfo);
        }
    }

    if (attacker.type === 'adversary' && hpToMark > 0) {
        checkAdversaryReactions("ON_DEAL_HP", attacker, finalTarget, gameState, damageEventInfo);
    }
    
    if (attacker.type === 'adversary' && hpToMark > 0) {
        if (damageInfo.isStandardAttack && attacker.passives.knockbackOnHP) {
             simLog(` -> ${attacker.name}'s PASSIVE triggers: Overwhelming Force!`);
             const knockbackEffect = {
                action_type: 'KNOCKBACK',
                range: attacker.passives.knockbackOnHP.range,
                is_direct: false
             };
             executeParsedEffect(knockbackEffect, attacker, finalTarget, gameState);
        }
    }

    if (finalTarget.current_hp <= 0) {
        simLog(` *** ${finalTarget.name} has been defeated! ***`);
        if (finalTarget.type === 'adversary') {
            checkAdversaryReactions("ON_DEFEAT", finalTarget, attacker, gameState, damageEventInfo);
        }
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

// simLog(message) captures text *during* a simulation run
function simLog(message) {
    BATCH_LOG.push(message);
}



