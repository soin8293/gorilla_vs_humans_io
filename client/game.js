const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let players = {}; // Store player states, keyed by sessionId
let localPlayerId = null;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial resize

const movement = {
    up: false,
    down: false,
    left: false,
    right: false
};

const keys = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right'
};

window.addEventListener('keydown', (e) => {
    if (keys[e.key]) {
        movement[keys[e.key]] = true;
        sendInput();
    }
});

window.addEventListener('keyup', (e) => {
    if (keys[e.key]) {
        movement[keys[e.key]] = false;
        sendInput(); // Send a "stop" if all keys are up, or current state
    }
});

function sendInput() {
    if (!window.colyseusRoom || !localPlayerId) return;

    let dx = 0;
    let dy = 0;

    if (movement.up) dy -= 1;
    if (movement.down) dy += 1;
    if (movement.left) dx -= 1;
    if (movement.right) dx += 1;

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx = dx / length;
        dy = dy / length;
    }
    
    // Only send if there's actual movement intention or if it's a change
    // The server side handlePlayerInput expects {t: "i", dx: number, dy: number}
    if (dx !== 0 || dy !== 0 || (!movement.up && !movement.down && !movement.left && !movement.right)) {
         window.colyseusRoom.send("i", { dx, dy });
    }
}


function drawPlayer(player) {
    if (!player) return;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.bodyRadius * 10, 0, Math.PI * 2); // Example: bodyRadius * 10 for visibility
    ctx.fillStyle = player.id === localPlayerId ? 'blue' : (player.role === 'gorilla' ? 'red' : 'green');
    ctx.fill();
    ctx.closePath();

    // Draw nickname
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.nickname, player.x, player.y - (player.bodyRadius * 10 + 5));
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background (simple grid for orientation)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }


    for (const id in players) {
        drawPlayer(players[id]);
    }

    requestAnimationFrame(gameLoop);
}

// Functions to be called by net.js
window.updatePlayers = (newPlayersState) => {
    players = {}; // Reset and update
    newPlayersState.forEach((player, id) => {
        players[id] = player;
    });
};

window.setLocalPlayerId = (id) => {
    localPlayerId = id;
};

window.removePlayer = (id) => {
    delete players[id];
}

// Start the game loop
gameLoop();