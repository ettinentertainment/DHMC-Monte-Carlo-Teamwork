// --- VISUALIZER RENDER FUNCTION ---
function initializeBattlemap(gameState) {
    const map = document.getElementById('battlemap-grid');
    if (!map) return;
    map.innerHTML = '';
    tokenCache = {};

    const mapSize = document.getElementById('map-size-select').value;
    CURRENT_BATTLEFIELD = {
        ...DAGGERHEART_RANGES,
        ...MAP_CONFIGS[mapSize] 
    };

    map.style.gridTemplateColumns = `repeat(${CURRENT_BATTLEFIELD.MAX_X}, 1fr)`;
    map.style.gridTemplateRows = `repeat(${CURRENT_BATTLEFIELD.MAX_Y}, 1fr)`;
    
    let gridHtml = '';
    const totalCells = CURRENT_BATTLEFIELD.MAX_X * CURRENT_BATTLEFIELD.MAX_Y;
    for (let i = 0; i < totalCells; i++) {
        gridHtml += '<div class="empty-cell"></div>';
    }
    map.innerHTML = gridHtml;

    if (gameState) {
        initializeTokens(gameState);
    }
}

function initializeTokens(gameState) {
    const map = document.getElementById('battlemap-grid');
    if (!map) return;

    for (const tokenId in tokenCache) {
        tokenCache[tokenId].remove();
    }
    tokenCache = {};

    for (const player of gameState.players) {
        const token = document.createElement('div');
        token.className = 'token player-token';
        token.id = player.id;
        map.appendChild(token);
        tokenCache[player.id] = token;
    }

    for (const adv of gameState.adversaries) {
        const token = document.createElement('div');
        token.className = 'token adversary-token';
        token.id = adv.id;
        map.appendChild(token);
        tokenCache[adv.id] = token;
    }
    
    renderBattlemap(gameState);
}

function renderBattlemap(gameState) {
    for (const player of gameState.players) {
        const token = tokenCache[player.id];
        if (!token) continue;

        if (player.current_hp <= 0) {
            token.style.display = 'none';
        } else {
            token.style.display = 'block';
            token.title = `${player.name} (HP: ${player.current_hp})`;
            token.style.gridColumn = player.position.x;
            token.style.gridRow = player.position.y;
        }
    }

    for (const adv of gameState.adversaries) {
        const token = tokenCache[adv.id];
        if (!token) continue;
        
        if (adv.current_hp <= 0) {
            token.style.display = 'none';
        } else {
            token.style.display = 'block';
            token.title = `${adv.name} (HP: ${adv.current_hp})`;
            token.style.gridColumn = adv.position.x;
            token.style.gridRow = adv.position.y;
        }
    }
}
