// --- ENVIRONMENT ENGINE ---
// Handles environment actions and effects.

function performEnvironmentAction(envAction, gameState) {
    simLog(`> GM SPOTLIGHT: Environment (${activeEnvironment.name}) activates "${envAction.name}"!`, 'log-gm');

    if (envAction.cost) {
        if (envAction.cost.type === 'fear') {
            gameState.fear -= envAction.cost.value;
            simLog(` GM spends ${envAction.cost.value} Fear (Total: ${gameState.fear})`);
        }
    }

    // --- CRITICAL FIX: Construct a safe 'agent' object for the environment ---
    // This prevents executeParsedEffect from crashing when checking for traits or passives
    const envAgent = {
        type: 'environment',
        name: activeEnvironment.name || "Environment",
        id: "environment-source",
        traits: { strength: 0, agility: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
        passives: {},
        proficiency: 1
    };

    // Determine targets based on action definition
    // Default to first player as placeholder; parser handles 'ALL_IN_RANGE' logic internally
    let target = gameState.players[0];

    if (envAction.parsed_effect && envAction.parsed_effect.actions) {
        for (const action of envAction.parsed_effect.actions) {
            executeParsedEffect(action, envAgent, target, gameState);
        }
    }
}