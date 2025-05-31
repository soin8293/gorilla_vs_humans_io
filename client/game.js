import { gameState, sendInput as sendNetInput, sendChatMessage as sendNetChatMessage } from './net.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const hudElement = document.getElementById('hud');
const localPlayerStatsElement = document.getElementById('localPlayerStats');
const globalHumanLivesElement = document.getElementById('globalHumanLives');
const phaseElement = document.getElementById('phase');
const chatMessagesElement = document.getElementById('chatMessages');
const chatInputElement = document.getElementById('chatInput');

// --- Sound Effects (Placeholders) ---
const sounds = {
    hit: new Audio(), // TODO: Add actual sound file path
    kill: new Audio(), // TODO: Add actual sound file path
    respawn: new Audio(), // TODO: Add actual sound file path
    gameOver: new Audio(), // TODO: Add actual sound file path
    gorillaAssigned: new Audio() // TODO: Add actual sound file path
};
// Example: sounds.hit.src = 'sounds/hit.wav';

function playSound(soundName) {
    if (sounds[soundName] && sounds[soundName].src) {
        sounds[soundName].currentTime = 0;
        sounds[soundName].play().catch(e => console.warn(`Error playing sound ${soundName}:`, e));
    }
}

// --- Canvas & Camera ---
let camera = {
    x: 0,
    y: 0,
    width: 800, // Will be updated
    height: 600, // Will be updated
    zoom: 1 // Future use
};

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.width = canvas.width;
    camera.height = canvas.height;
    // If map is smaller than viewport, center map. Otherwise, camera follows player.
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function updateCamera() {
    const localPlayer = gameState.players.get(gameState.localPlayerId);
    if (localPlayer) {
        // Center camera on player, clamping to map boundaries
        camera.x = Math.max(0, Math.min(localPlayer.x - camera.width / 2, gameState.mapDimensions.width - camera.width));
        camera.y = Math.max(0, Math.min(localPlayer.y - camera.height / 2, gameState.mapDimensions.height - camera.height));
    } else {
        // If no local player, or map smaller than screen, center map or show default view
        camera.x = Math.max(0, (gameState.mapDimensions.width - camera.width) / 2);
        camera.y = Math.max(0, (gameState.mapDimensions.height - camera.height) / 2);
    }
}


// --- Input Handling ---
const movement = { up: false, down: false, left: false, right: false };
const keys = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right'
};

window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInputElement) return; // Don't move if typing in chat
    if (keys[e.key]) {
        movement[keys[e.key]] = true;
        sendMovementInput();
    }
});

window.addEventListener('keyup', (e) => {
    if (document.activeElement === chatInputElement && e.key === 'Enter') {
        const messageText = chatInputElement.value;
        if (messageText.trim() !== "") {
            sendNetChatMessage(messageText);
            chatInputElement.value = "";
        }
        chatInputElement.blur(); // Unfocus after sending
        return;
    }
    if (keys[e.key]) {
        movement[keys[e.key]] = false;
        sendMovementInput();
    }
});

function sendMovementInput() {
    if (!gameState.localPlayerId) return;
    let dx = 0;
    let dy = 0;
    if (movement.up) dy -= 1;
    if (movement.down) dy += 1;
    if (movement.left) dx -= 1;
    if (movement.right) dx += 1;

    // Normalize diagonal movement (optional, server might do this)
    if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
    }
    sendNetInput("i", { dx, dy }); // "i" for input
}

// --- Drawing Functions ---
function drawMapBackground() {
    ctx.fillStyle = '#2c2c2c'; // Darker background for the map area
    ctx.fillRect(0, 0, gameState.mapDimensions.width, gameState.mapDimensions.height);

    // Simple grid for orientation within map boundaries
    ctx.strokeStyle = '#383838';
    ctx.lineWidth = 1;
    for (let x = 0; x <= gameState.mapDimensions.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, gameState.mapDimensions.height);
        ctx.stroke();
    }
    for (let y = 0; y <= gameState.mapDimensions.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(gameState.mapDimensions.width, y);
        ctx.stroke();
    }
}

function drawObstacles() {
    ctx.fillStyle = '#555555'; // Obstacle color
    gameState.obstacles.forEach(obs => {
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    });
}

function drawPlayer(player) {
    if (!player) return;

    const isLocal = player.id === gameState.localPlayerId;
    const radius = player.role === 'gorilla' ? 20 : 10; // Gorilla larger
    const color = player.role === 'gorilla' ? 'darkred' : (isLocal ? 'deepskyblue' : 'lightgreen');

    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;

    if (player.hp <= 0) { // Dead-state tint
        ctx.fillStyle = 'rgba(100, 100, 100, 0.7)'; // Semi-transparent grey
    }
    ctx.fill();
    if (isLocal || player.role === 'gorilla') { // Outline local player and gorilla for visibility
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.closePath();

    // Nickname
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.nickname, player.x, player.y - radius - 15);

    // HP Bar
    if (player.hp > 0) {
        const hpBarWidth = 30;
        const hpBarHeight = 5;
        const hpRatio = player.hp / player.maxHp;
        ctx.fillStyle = 'grey';
        ctx.fillRect(player.x - hpBarWidth / 2, player.y - radius - 10, hpBarWidth, hpBarHeight);
        ctx.fillStyle = hpRatio > 0.5 ? 'green' : (hpRatio > 0.2 ? 'orange' : 'red');
        ctx.fillRect(player.x - hpBarWidth / 2, player.y - radius - 10, hpBarWidth * hpRatio, hpBarHeight);
    }

    // Stamina Bar (if applicable, e.g., for humans or gorilla actions)
    if (player.stamina !== undefined && player.maxStamina !== undefined && player.maxStamina > 0) {
        const staminaBarWidth = 30;
        const staminaBarHeight = 3;
        const staminaRatio = player.stamina / player.maxStamina;
        ctx.fillStyle = 'darkblue';
        ctx.fillRect(player.x - staminaBarWidth / 2, player.y - radius - 5, staminaBarWidth, staminaBarHeight);
        ctx.fillStyle = 'lightblue';
        ctx.fillRect(player.x - staminaBarWidth / 2, player.y - radius - 5, staminaBarWidth * staminaRatio, staminaBarHeight);
    }
}

function drawHUD() {
    const localPlayer = gameState.players.get(gameState.localPlayerId);

    // Local Player Stats
    if (localPlayer) {
        localPlayerStatsElement.innerHTML = `
            HP: ${localPlayer.hp}/${localPlayer.maxHp} | 
            Stamina: ${localPlayer.stamina !== undefined ? `${localPlayer.stamina}/${localPlayer.maxStamina}` : 'N/A'} | 
            Lives: ${localPlayer.lives !== undefined ? localPlayer.lives : 'N/A'}
        `;
    } else {
        localPlayerStatsElement.innerHTML = "Spectating or Connecting...";
    }

    // Global Human Lives
    globalHumanLivesElement.innerHTML = `Human Lives: ${gameState.totalHumanLives}`;

    // Phase Banner & Countdown/Timer
    let phaseText = "";
    switch (gameState.gamePhase) {
        case "lobby":
            phaseText = `LOBBY (Waiting for players...)`;
            break;
        case "countdown":
            phaseText = `ROUND STARTS IN: ${gameState.countdown}`;
            break;
        case "active":
            phaseText = `ROUND TIME: ${Math.max(0, Math.floor(gameState.roundTime / 1000))}s`;
            break;
        case "results":
            // Determine winner based on who is alive or game state details
            let winnerText = "GAME OVER"; 
            const gorilla = Array.from(gameState.players.values()).find(p => p.role === 'gorilla');
            if (gorilla && gorilla.hp > 0 && gameState.totalHumanLives <= 0) {
                winnerText = "GORILLA WINS!";
            } else if (gameState.totalHumanLives > 0 && (!gorilla || gorilla.hp <= 0)) {
                winnerText = "HUMANS WIN!";
            } else if (gameState.roundTime <=0 && gameState.totalHumanLives > 0 && gorilla && gorilla.hp > 0) {
                winnerText = "TIME'S UP! HUMANS SURVIVED!"; // Or specific tie condition
            }
            phaseText = winnerText;
            break;
        case "connecting":
            phaseText = "CONNECTING TO SERVER...";
            break;
        case "disconnected":
            phaseText = "DISCONNECTED";
            break;
        case "error":
            phaseText = "CONNECTION ERROR";
            break;
        default:
            phaseText = gameState.gamePhase.toUpperCase();
    }
    phaseElement.textContent = phaseText;
    phaseElement.style.display = (gameState.gamePhase === "active" && gameState.roundTime > 0) ? 'none' : 'block'; // Hide active timer if preferred
    if (gameState.gamePhase === "active") { // Show round timer in HUD if phase banner is hidden
        globalHumanLivesElement.innerHTML += ` | Time: ${Math.max(0, Math.floor(gameState.roundTime / 1000))}s`;
    }


    // Results Panel (could be combined with phase banner or be a separate element)
    if (gameState.gamePhase === "results") {
        // This is already handled by the phase banner logic above.
        // If a more detailed panel is needed, it would be drawn here or in HTML.
    }
}

// --- Chat ---
window.addChatMessage = function(senderNickname, messageText, isSystem = false) {
    const li = document.createElement('li');
    if (isSystem) {
        li.innerHTML = `<em>${messageText}</em>`;
        li.style.color = "yellow";
    } else {
        li.textContent = `${senderNickname}: ${messageText}`;
    }
    chatMessagesElement.appendChild(li);
    // Auto-scroll to bottom
    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    // Limit chat messages
    while (chatMessagesElement.children.length > 20) { // Keep last 20 messages
        chatMessagesElement.removeChild(chatMessagesElement.firstChild);
    }
};

// --- Event Processing ---
let processedEventIds = new Set(); // To avoid processing same event multiple times if state syncs fast

function processGameEvents() {
    if (!gameState.events || gameState.events.length === 0) return;

    gameState.events.forEach(event => {
        if (processedEventIds.has(event.id)) return; // Assuming events have a unique ID from server

        console.log("Processing event:", event);
        switch (event.type) {
            case 'hit':
                // Visual: particle effect, screen shake?
                playSound('hit');
                addChatMessage(null, `${event.targetNickname} was hit by ${event.attackerNickname}!`, true);
                break;
            case 'kill':
                // Visual: death animation, fade out
                playSound('kill');
                addChatMessage(null, `${event.victimNickname} was killed by ${event.killerNickname}!`, true);
                break;
            case 'respawn':
                playSound('respawn');
                addChatMessage(null, `${event.nickname} respawned!`, true);
                break;
            case 'game_over':
                playSound('gameOver');
                // Handled by phase banner mostly
                break;
            case 'gorilla_assigned':
                playSound('gorillaAssigned');
                const player = gameState.players.get(event.playerId);
                if (player) {
                    addChatMessage(null, `${player.nickname} is the GORILLA!`, true);
                }
                break;
            // Add more event types as needed
        }
        processedEventIds.add(event.id); // Mark as processed
    });

    // Simple pruning of processedEventIds to prevent memory leak, server should handle actual event lifecycle
    if (processedEventIds.size > 100) {
        const oldEvents = Array.from(processedEventIds).slice(0, 50);
        oldEvents.forEach(id => processedEventIds.delete(id));
    }
}


// --- Main Game Loop ---
function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);

    updateCamera(); // Update camera based on player position and map size

    // Clear viewport (everything outside map is plain background)
    ctx.fillStyle = '#1e1e1e'; // Very dark grey for areas outside the map
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y); // Apply camera transformation

    // --- Drawing world elements (relative to map) ---
    drawMapBackground();
    drawObstacles();
    gameState.players.forEach(drawPlayer);

    ctx.restore(); // Restore context to draw HUD elements in screen space

    // --- Drawing UI elements (fixed on screen) ---
    drawHUD();
    processGameEvents(); // Process and display effects for new events
}

// Initialize chat input listener (moved here from keyup for clarity)
chatInputElement.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const messageText = chatInputElement.value;
        if (messageText.trim() !== "") {
            sendNetChatMessage(messageText);
            chatInputElement.value = "";
        }
        // chatInputElement.blur(); // Optional: unfocus after sending
    }
});


// Start the game loop
console.log("game.js loaded, starting game loop. Waiting for connection...");
gameLoop();