// --- CORE ENGINE ---
// Handles the simulation loop, batch processing, logging context, and initialization.

async function runSimulationBatch(count, mapSize) {
    for (let i = 1; i <= count; i++) {
        // Await the completion of a single simulation before starting the next
        // This makes sure sims run sequentially and not in parallel
        await runSingleSimulationAsync(count, mapSize, i);
    }
}

function runSingleSimulationAsync(batchTotalCount, mapSize, currentSimNumber) {
    // This function returns a Promise that resolves when the simulation is complete
    return new Promise((resolve) => {
        BATCH_LOG = []; // Always reset the log for a new sim

        simLog('======================================');
        simLog(`INITIALIZING NEW SIMULATION #${currentSimNumber} / ${batchTotalCount}...`);
        simLog('======================================');

        CURRENT_BATTLEFIELD = {
            ...DAGGERHEART_RANGES,
            ...MAP_CONFIGS[mapSize]
        };

        simLog(`Simulating on ${mapSize} map (${CURRENT_BATTLEFIELD.MAX_X}x${CURRENT_BATTLEFIELD.MAX_Y})...`);

        const sceneDifficulty = activeEnvironment ? activeEnvironment.difficulty : 10;
        simLog(`Active Environment Difficulty set to: ${sceneDifficulty}`);

        if (activeParty.length === 0) {
            simLog('--- ERROR --- \\nAdd a player to the Active Scene.');
            printToLog(BATCH_LOG.join('\\n'));
            BATCH_LOG = [];
            resolve(); // Resolve the promise to not block the batch
            return;
        }
        if (activeAdversaries.length === 0) {
            simLog('--- ERROR --- \\nAdd an adversary to the Active Scene.');
            printToLog(BATCH_LOG.join('\\n'));
            BATCH_LOG = [];
            resolve(); // Resolve the promise to not block the batch
            return;
        }

        let playerAgents, adversaryAgents;
        try {
            playerAgents = activeParty.map(instantiatePlayerAgent);
            adversaryAgents = activeAdversaries.map(instantiateAdversaryAgent);
        } catch (e) {
            simLog(`--- ERROR --- \\nFailed to parse agent JSON. \\n${e.message}`);
            console.error("Error during instantiation:", e);
            printToLog(BATCH_LOG.join('\\n'));
            BATCH_LOG = [];
            resolve(); // Resolve the promise to not block the batch
            return;
        }

        let currentPlaybackLog = [];
        const recordPlayback = (batchTotalCount === 1);
        const startTime = Date.now();

        const gameState = {
            players: playerAgents,
            adversaries: adversaryAgents,
            fear: 1 * playerAgents.length,
            spotlight: 0,
            lastPlayerSpotlight: 0,
            sceneDifficulty: sceneDifficulty,
            addD4Damage: false,
            roundCounter: 0,
            maxRounds: 100,
            pcTurnCounter: 0
        };

        const addDamageMod = activeBpModifiers.find(m => m.type === 'ADD_D4_DAMAGE');
        if (addDamageMod) {
            gameState.addD4Damage = true;
            simLog(` (BP Mod Active: All adversaries deal +1d4 damage) [${addDamageMod.name}]`);
        }

        simLog(`Simulation Initialized. Fear: ${gameState.fear}`);

        // Force print the initialization logs so the user sees setup immediately
        printToLog(BATCH_LOG); // Pass array directly
        BATCH_LOG = []; // Clear buffer so we don't double-print later


        // --- This function contains the logic that used to be *after* the while loop ---
        function endSimulation(finalGameState, winner) {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            if (recordPlayback) {
                recordSnapshot(finalGameState, currentPlaybackLog);
            }

            if (batchTotalCount === 1) {
                survivorPool = []; //Clear the pool for a new single run
                const survivors = finalGameState.players.filter(p => p.current_hp > 0);
                if (survivors.length > 0) {
                    simLog(` --- Saving ${survivors.length} Survivor(s) ---`);
                    survivors.forEach(survivor => {
                        survivor.simId = `survivor-instance-${Date.now()}-${Math.random()}`;
                        survivorPool.push(survivor);
                    });
                }
            }

            simLog(`\\n--- SIMULATION #${currentSimNumber} COMPLETE ---`);
            simLog(`Winner: ${winner} in ${finalGameState.roundCounter} rounds.`);
            simLog(`Duration: ${duration.toFixed(3)}s`);

            const scoreboard = generateScoreboard(finalGameState, winner);
            const winnerClass = winner === "Players" ? "scoreboard-win" : "scoreboard-loss";

            simHistory.push({
                id: simHistory.length + 1,
                winner: winner,
                rounds: finalGameState.roundCounter,
                duration: duration,
                players: finalGameState.players.map(p => ({ name: p.name, hp: p.current_hp, stress: p.current_stress })),
                adversaries: finalGameState.adversaries.map(a => ({ name: a.name, hp: a.current_hp, stress: a.current_stress })),
                playbackLog: currentPlaybackLog.length > 0 ? currentPlaybackLog : null
            });

            printToLog(BATCH_LOG); // Pass array directly
            BATCH_LOG = []; // Clear log for next run
            printToLog(scoreboard, winnerClass); // Print the color-coded scoreboard

            resolve(); // This resolves the Promise, allowing the batch loop to continue
        }



        // --- This is the new ASYNC simulation loop ---
        function runSimulationStep() {
            console.log(`[DEBUG] Starting Simulation Step. Round: ${gameState.roundCounter}, Spotlight: ${gameState.spotlight}`); // <--- ADDED
            if (isCombatOver(gameState)) {
                const playersAlive = gameState.players.some(p => p.current_hp > 0);
                const winner = playersAlive ? "Players" : "Adversaries";
                endSimulation(gameState, winner);
                return;
            }

            if (gameState.roundCounter >= gameState.maxRounds) {
                simLog(`--- SIMULATION HALTED --- \\nReached max round limit (100).`);
                endSimulation(gameState, "Stalemate");
                return;
            }

            let lastOutcome = '';

            if (recordPlayback) {
                recordSnapshot(gameState, currentPlaybackLog);
            }

            if (gameState.spotlight === 'GM') {
                lastOutcome = executeGMTurn(gameState);
                gameState.roundCounter++;
                simLog(` --- Round ${gameState.roundCounter} ---`, 'log-round');
            } else {
                const actingPlayer = gameState.players[gameState.spotlight];
                if (actingPlayer.current_hp > 0) {
                    lastOutcome = executePCTurn(actingPlayer, gameState);
                    gameState.lastPlayerSpotlight = gameState.spotlight;

                    // NEW: Increment internal turn counter to prevent infinite PC loops
                    gameState.pcTurnCounter = (gameState.pcTurnCounter || 0) + 1;
                    if (gameState.pcTurnCounter > 5) {
                        simLog(`(Force ending round due to excessive PC actions)`);
                        gameState.roundCounter++;
                        gameState.pcTurnCounter = 0;
                    }

                } else {
                    lastOutcome = 'PC_DOWN';
                }
            }

            determineNextSpotlight(lastOutcome, gameState);

            // This is the most important part: yield to the browser event loop
            setTimeout(runSimulationStep, 0);
        }

        // --- Start the async loop ---
        runSimulationStep();
    });
}

// --- NEW: SCOREBOARD GENERATOR (Condensed) ---
function generateScoreboard(gameState, winner) {
    let board = [];
    board.push(`\n--- PLAYER CHARACTERS ---`);

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