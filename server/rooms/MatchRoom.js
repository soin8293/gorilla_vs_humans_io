const colyseus = require('colyseus');
const { Schema, MapSchema, ArraySchema, type, defineTypes } = require('@colyseus/schema');
const fs = require('node:fs');
const path = require('node:path');

// Helper to generate unique IDs for events
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Import systems
const CombatSystem = require('../systems/combat');
const StaminaSystem = require('../systems/stamina');
const AIBotSystem = require('../systems/aiBot');
const { circleRectCollision } = require('../utils/collision');

// --- Game Constants ---
const MAX_PLAYERS = 11; // 1 Gorilla, 10 Humans
const COUNTDOWN_SECONDS = 5;
const ROUND_DURATION_SECONDS = 5 * 60; // 5 minutes
const RESULTS_DURATION_SECONDS = 15;
const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;
const TICK_RATE_HZ = 10; // Server authority tick as per spec
const PATCH_RATE_MS = 1000 / TICK_RATE_HZ; // 100ms
const MAX_CHAT_MESSAGES = 20;
const BOT_TARGET_TOTAL_HUMANS = 10; // Target total humans (players + bots)

// --- Player State ---
class Player extends Schema {
    constructor() {
        super();
        this.id = "";
        this.nickname = "Player";
        this.role = "human"; // "human" or "gorilla"
        this.x = Math.random() * MAP_WIDTH;
        this.y = Math.random() * MAP_HEIGHT;
        this.hp = 10;
        this.lives = 10;
        this.st = 50; // Stamina
        this.state = "playing"; // "playing", "dead", "spectating"
        this.isBot = false;
        this.lastAttackTime = 0;
        this.moveSpeed = 5; // Will be set from balance.json
        this.punchCooldownMs = 400; // Will be set from balance.json
        this.bodyRadius = 1; // Default, will be set from balance.json
    }
}
defineTypes(Player, {
    id: "string",
    nickname: "string",
    role: "string",
    x: "number",
    y: "number",
    hp: "number",
    lives: "number",
    st: "number",
    state: "string",
    isBot: "boolean",
    lastAttackTime: "number",
    moveSpeed: "number",
    punchCooldownMs: "number",
    bodyRadius: "number",
});

// --- Obstacle State (Simple Example) ---
class Obstacle extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        // this.type = "rectangle"; // Could add 'circle' etc.
    }
}
defineTypes(Obstacle, {
    x: "number",
    y: "number",
    width: "number",
    height: "number",
    // type: "string",
});

// --- Chat Message State ---
class ChatMessage extends Schema {
    constructor() {
        super();
        this.senderId = "";
        this.nickname = "";
        this.message = "";
        this.timestamp = 0;
    }
}
defineTypes(ChatMessage, {
    senderId: "string",
    nickname: "string",
    message: "string",
    timestamp: "number",
});

// --- Game Event State ---
class GameEvent extends Schema {
    constructor() {
        super();
        this.id = generateUniqueId();
        this.ts = 0;
        this.type = ""; // "hit", "kill", "respawn", "game_over", "gorilla_assigned"
        
        // Common fields for simple messages or context
        this.message = "";

        // Fields for 'hit'
        this.attackerId = "";
        this.attackerNickname = "";
        this.targetId = "";
        this.targetNickname = "";
        this.damage = 0;

        // Fields for 'kill'
        this.victimId = "";
        this.victimNickname = "";
        this.killerId = "";
        this.killerNickname = "";

        // Fields for 'respawn' & 'gorilla_assigned'
        this.playerId = "";
        this.playerNickname = "";

        // Fields for 'game_over'
        this.reason = "";
    }
}
defineTypes(GameEvent, {
    id: "string",
    ts: "number",
    type: "string",
    message: "string",

    attackerId: "string",
    attackerNickname: "string",
    targetId: "string",
    targetNickname: "string",
    damage: "number",

    victimId: "string",
    victimNickname: "string",
    killerId: "string",
    killerNickname: "string",

    playerId: "string",
    playerNickname: "string",

    reason: "string"
});

// --- Game State ---
class GameState extends Schema {
    constructor() {
        super();
        this.gamePhase = "lobby"; // "lobby", "countdown", "round", "results"
        this.roundTime = 0; // Seconds since round start
        this.countdown = COUNTDOWN_SECONDS;
        this.players = new MapSchema();
        this.gorillaQueue = new ArraySchema(); // Stores client.sessionId
        this.events = new ArraySchema(); // Array of GameEvent objects
        this.mapObstacles = new ArraySchema();
        this.chatMessages = new ArraySchema();
        this.gorillaPlayerId = null; // ID of the current gorilla
        this.totalHumanLives = 0;
        this.mapWidth = MAP_WIDTH; // Expose map dimensions
        this.mapHeight = MAP_HEIGHT; // Expose map dimensions
    }
}
defineTypes(GameState, {
    gamePhase: "string",
    roundTime: "number",
    countdown: "number",
    players: { map: Player },
    gorillaQueue: ["string"],
    events: [GameEvent], // Changed from [["string"]]
    mapObstacles: [Obstacle],
    chatMessages: [ChatMessage],
    gorillaPlayerId: "string",
    totalHumanLives: "number",
    mapWidth: "number",
    mapHeight: "number"
});

class MatchRoom extends colyseus.Room {
    onCreate(options) {
        console.log("MatchRoom created!", options);

        // Load balance configuration
        try {
            const balancePath = path.join(__dirname, '..', 'config', 'balance.json');
            const rawBalanceData = fs.readFileSync(balancePath, 'utf8');
            this.balance = JSON.parse(rawBalanceData);
            // Add body radii to balance if not present, for consistency
            this.balance.gorilla.body_radius = this.balance.gorilla.body_radius || 3;
            this.balance.human.body_radius = this.balance.human.body_radius || 1;
            this.balance.gorilla.damage_to_human = this.balance.gorilla.gorilla_nocrit_damage || 3; // from previous step
            this.balance.human.damage_to_gorilla = this.balance.human.damage_to_gorilla || 1;


        } catch (e) {
            console.error("Failed to load balance.json:", e);
            this.balance = { // Fallback default balance
                gorilla: { lives: 1, health: 100, crit_kill_pct: 0, stamina: 30, stamina_per_punch: 1, regen_per_sec: 2, move_speed: 4, punch_cooldown_ms: 600, hit_range: 1.2, gorilla_nocrit_damage: 3, body_radius: 3 },
                human: { lives: 10, health: 10, crit_kill_pct: 40, stamina: 50, stamina_per_punch: 1, regen_per_sec: 4, move_speed: 5, punch_cooldown_ms: 400, hit_range: 0.9, damage_to_gorilla: 1, body_radius: 1 }
            };
        }

        // Initialize systems
        this.staminaSystem = new StaminaSystem(this.balance);
        this.combatSystem = new CombatSystem(this.balance, this.respawnPlayer.bind(this));
        this.aiBotSystem = new AIBotSystem(this, this.balance);

        this.setState(new GameState());
        this.setPatchRate(PATCH_RATE_MS); // 10 Hz as per spec

        // Example obstacles (replace with JSON loading if needed)
        const obs1 = new Obstacle();
        obs1.x = 20; obs1.y = 20; obs1.width = 10; obs1.height = 60;
        this.state.mapObstacles.push(obs1);
        const obs2 = new Obstacle();
        obs2.x = 70; obs2.y = 20; obs2.width = 10; obs2.height = 60;
        this.state.mapObstacles.push(obs2);


        this.setSimulationInterval((deltaTime) => this.update(deltaTime), PATCH_RATE_MS);

        this.onMessage("r", (client, message) => this.handleRoleSelection(client, message)); // Role selection
        this.onMessage("i", (client, message) => this.handlePlayerInput(client.sessionId, message)); // Input (move)
        this.onMessage("a", (client, message) => this.handlePlayerInput(client.sessionId, message)); // Attack
        this.onMessage("c", (client, message) => this.handleChatMessage(client, message)); // Chat
        this.onMessage("spec_hb", (client, message) => { /* Spectator heartbeat, do nothing for now */ });
    }

    // Called by AIBotSystem to add a bot to the room's state
    addNewBotToState(botData) {
        const player = new Player().assign(botData);
        player.moveSpeed = this.balance.human.move_speed;
        player.punchCooldownMs = this.balance.human.punch_cooldown_ms;
        player.bodyRadius = this.balance.human.body_radius;
        this.state.players.set(player.id, player);
        console.log(`Bot ${player.id} added to state.`);
    }
    
    // Called by AIBotSystem or other systems to queue actions for players/bots
    // This is also the direct handler for client messages 'i' and 'a'
    handlePlayerInput(playerId, action) {
        const player = this.state.players.get(playerId);
        if (!player || player.state === 'dead' || player.state === 'spectating') return;
        if (this.state.gamePhase !== 'round') return;

        const now = this.clock.currentTime;

        if (action.t === 'i') { // Move input: { t:"i", dx:0.7, dy:-0.1 }
            if (typeof action.dx === 'number' && typeof action.dy === 'number') {
                const normalizedDx = Math.max(-1, Math.min(1, action.dx));
                const normalizedDy = Math.max(-1, Math.min(1, action.dy));
                
                const moveDistance = player.moveSpeed * (PATCH_RATE_MS / 1000); // deltaTime for one tick
                
                let newX = player.x + normalizedDx * moveDistance;
                let newY = player.y + normalizedDy * moveDistance;

                // Basic boundary collision
                let proposedX = Math.max(player.bodyRadius, Math.min(MAP_WIDTH - player.bodyRadius, newX));
                let proposedY = Math.max(player.bodyRadius, Math.min(MAP_HEIGHT - player.bodyRadius, newY));

                // Obstacle collision using circleRectCollision
                let collisionX = false;
                let collisionY = false;

                for (const obs of this.state.mapObstacles) {
                    // Check collision with proposed X, current Y
                    if (circleRectCollision(proposedX, player.y, player.bodyRadius, obs.x, obs.y, obs.width, obs.height)) {
                        collisionX = true;
                        // Adjust X: place player next to obstacle
                        if (normalizedDx > 0) proposedX = obs.x - player.bodyRadius - 0.01; // Moving right, place left of obs
                        else if (normalizedDx < 0) proposedX = obs.x + obs.width + player.bodyRadius + 0.01; // Moving left, place right of obs
                        else proposedX = player.x; // No horizontal movement, revert to current x
                        break;
                    }
                }
                // Boundary check for X after potential adjustment
                proposedX = Math.max(player.bodyRadius, Math.min(MAP_WIDTH - player.bodyRadius, proposedX));


                for (const obs of this.state.mapObstacles) {
                    // Check collision with (now potentially adjusted) proposed X, and proposed Y
                    if (circleRectCollision(proposedX, proposedY, player.bodyRadius, obs.x, obs.y, obs.width, obs.height)) {
                        collisionY = true;
                        // Adjust Y: place player next to obstacle
                        if (normalizedDy > 0) proposedY = obs.y - player.bodyRadius - 0.01; // Moving down, place above obs
                        else if (normalizedDy < 0) proposedY = obs.y + obs.height + player.bodyRadius + 0.01; // Moving up, place below obs
                        else proposedY = player.y; // No vertical movement, revert to current y
                        break;
                    }
                }
                // Boundary check for Y after potential adjustment
                proposedY = Math.max(player.bodyRadius, Math.min(MAP_HEIGHT - player.bodyRadius, proposedY));
                
                // Final check: if after adjustments, still colliding (e.g. corner case), try to only allow movement on one axis if the other was blocked.
                // This is a simple slide. More complex resolution might be needed for perfect cornering.
                let finalX = proposedX;
                let finalY = proposedY;

                if (collisionX && collisionY) { // If collided on both axes attempts
                    // Try moving only on Y axis from original position
                    let tempY = player.y + normalizedDy * moveDistance;
                    tempY = Math.max(player.bodyRadius, Math.min(MAP_HEIGHT - player.bodyRadius, tempY));
                    let stillCollidesYOnly = false;
                    for (const obs of this.state.mapObstacles) {
                        if (circleRectCollision(player.x, tempY, player.bodyRadius, obs.x, obs.y, obs.width, obs.height)) {
                            stillCollidesYOnly = true;
                            break;
                        }
                    }
                    if (!stillCollidesYOnly) {
                        finalX = player.x; // Keep original X
                        finalY = tempY;
                    } else {
                        // Try moving only on X axis from original position
                        let tempX = player.x + normalizedDx * moveDistance;
                        tempX = Math.max(player.bodyRadius, Math.min(MAP_WIDTH - player.bodyRadius, tempX));
                        let stillCollidesXOnly = false;
                        for (const obs of this.state.mapObstacles) {
                             if (circleRectCollision(tempX, player.y, player.bodyRadius, obs.x, obs.y, obs.width, obs.height)) {
                                stillCollidesXOnly = true;
                                break;
                            }
                        }
                        if (!stillCollidesXOnly) {
                            finalX = tempX;
                            finalY = player.y; // Keep original Y
                        } else {
                            // Stuck, don't move
                            finalX = player.x;
                            finalY = player.y;
                        }
                    }
                }

                player.x = finalX;
                player.y = finalY;
            }
        } else if (action.t === 'a') { // Attack input: { t:"a" }
            if (now - player.lastAttackTime >= player.punchCooldownMs) {
                if (this.staminaSystem.consumeStamina(player)) {
                    player.lastAttackTime = now;
                    const allPlayersArray = Array.from(this.state.players.values());
                    const combatEventsData = this.combatSystem.handleAttackAction(player, allPlayersArray);
                    if (combatEventsData && combatEventsData.length > 0) {
                        combatEventsData.forEach(eventData => {
                            const gameEvent = new GameEvent();
                            gameEvent.ts = now; // Use current time from this tick
                            gameEvent.type = eventData[0];

                            switch(eventData[0]) {
                                case 'hit':
                                    gameEvent.attackerId = eventData[1];
                                    gameEvent.targetId = eventData[2];
                                    gameEvent.damage = eventData[3];
                                    gameEvent.targetNickname = eventData[4];
                                    gameEvent.attackerNickname = eventData[5];
                                    break;
                                case 'kill':
                                    gameEvent.killerId = eventData[1];
                                    gameEvent.victimId = eventData[2];
                                    gameEvent.victimNickname = eventData[3];
                                    gameEvent.killerNickname = eventData[4];
                                    break;
                                case 'respawn':
                                    gameEvent.playerId = eventData[1];
                                    gameEvent.playerNickname = eventData[2];
                                    break;
                            }
                            this.state.events.push(gameEvent);
                        });
                    }
                } else {
                    // console.log(`Player ${player.id} out of stamina for attack.`);
                    // Optionally send an "out_of_stamina" event
                }
            }
        }
    }


    handleRoleSelection(client, message) {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        const desiredRole = message.role;
        if (desiredRole === "gorilla") {
            if (!this.state.gorillaQueue.includes(client.sessionId)) {
                this.state.gorillaQueue.push(client.sessionId);
            }
            // If in lobby and no gorilla, try to assign immediately
            if (this.state.gamePhase === "lobby" && !this.state.gorillaPlayerId) {
                this.tryAssignGorilla();
            }
        } else if (desiredRole === "human") {
            // If they were in gorilla queue, remove them
            const queueIndex = this.state.gorillaQueue.indexOf(client.sessionId);
            if (queueIndex > -1) {
                this.state.gorillaQueue.splice(queueIndex, 1);
            }
            player.role = "human";
            this.setPlayerDefaults(player); // Reset to human defaults
            // If they were the gorilla, need to handle gorilla leaving
            if (this.state.gorillaPlayerId === client.sessionId) {
                this.handleGorillaLeave();
            }
        }
         console.log(`Player ${player.nickname} (${client.sessionId}) selected role: ${player.role}. Gorilla queue: ${this.state.gorillaQueue.length}`);
    }
    
    tryAssignGorilla() {
        if (this.state.gorillaQueue.length > 0 && !this.state.gorillaPlayerId) {
            const newGorillaId = this.state.gorillaQueue.shift(); // First in queue gets it
            const gorillaPlayer = this.state.players.get(newGorillaId);
            if (gorillaPlayer) {
                gorillaPlayer.role = "gorilla";
                this.setPlayerDefaults(gorillaPlayer);
                this.state.gorillaPlayerId = newGorillaId;
                console.log(`Assigned Gorilla role to ${gorillaPlayer.nickname} (${newGorillaId})`);
                
                const assignEvent = new GameEvent();
                assignEvent.ts = this.clock.currentTime;
                assignEvent.type = "gorilla_assigned";
                assignEvent.playerId = newGorillaId;
                assignEvent.playerNickname = gorillaPlayer.nickname;
                this.state.events.push(assignEvent);
                // this.broadcast("gorilla_assigned", { playerId: newGorillaId, nickname: gorillaPlayer.nickname }); // Replaced by state event
                return true;
            }
        }
        return false;
    }

    handleGorillaLeave() {
        console.log(`Gorilla ${this.state.gorillaPlayerId} left or changed role.`);
        const oldGorillaId = this.state.gorillaPlayerId;
        this.state.gorillaPlayerId = null;
        
        if (this.state.gamePhase === "round") {
            // End round, humans win by default
            // this.state.events.push(new ArraySchema("game_over", "humans_win_gorilla_left")); // Old event style
            this.startResultsPhase("humans_win_gorilla_left"); // This will create the GameEvent
        } else if (this.state.gamePhase === "lobby" || this.state.gamePhase === "countdown") {
            // Try to assign a new gorilla from the queue
            this.tryAssignGorilla();
        }
        // Ensure the player who left is no longer marked as gorilla if they are still in room
        const formerGorillaPlayer = this.state.players.get(oldGorillaId);
        if(formerGorillaPlayer && formerGorillaPlayer.role === 'gorilla') {
            formerGorillaPlayer.role = 'human'; // Revert to human if they didn't pick a new role
            this.setPlayerDefaults(formerGorillaPlayer);
        }
    }

    onJoin(client, options) {
        console.log(client.sessionId, "joined with options:", options);
        const player = new Player();
        player.id = client.sessionId;
        player.nickname = options.nickname || `Player${Math.floor(Math.random() * 1000)}`;
        // Role is initially human, player sends message to select role preference
        player.role = "human"; 
        this.setPlayerDefaults(player);
        
        this.state.players.set(client.sessionId, player);
        console.log(`Player ${player.nickname} (${client.sessionId}) joined as ${player.role}. Total players: ${this.state.players.size}`);

        // Send full state snapshot to joining client (Colyseus does this automatically on first join if schema is set)
        // But we can send a custom welcome message if needed
        client.send("welcome", { message: "Welcome to Gorilla vs Humans!", yourId: client.sessionId });
    }

    setPlayerDefaults(player) {
        const config = this.balance[player.role];
        if (!config) {
            console.error(`No balance config found for role: ${player.role}`);
            return;
        }
        player.hp = config.health;
        player.lives = config.lives;
        player.st = config.stamina;
        player.moveSpeed = config.move_speed;
        player.punchCooldownMs = config.punch_cooldown_ms;
        player.bodyRadius = config.body_radius;
        player.state = "playing"; // Reset state
        player.x = Math.random() * (MAP_WIDTH - 2 * player.bodyRadius) + player.bodyRadius;
        player.y = Math.random() * (MAP_HEIGHT - 2 * player.bodyRadius) + player.bodyRadius;
    }

    respawnPlayer(player) { // player object from state
        if (!player) return;
        const config = this.balance[player.role];
        player.hp = config.health; // Full HP for the new life
        player.st = config.stamina; // Full stamina
        player.x = Math.random() * (MAP_WIDTH - 2 * player.bodyRadius) + player.bodyRadius;
        player.y = Math.random() * (MAP_HEIGHT - 2 * player.bodyRadius) + player.bodyRadius;
        player.state = "playing";
        console.log(`Player ${player.nickname} respawned. Lives: ${player.lives}`);
        // Event for respawn is already added by CombatSystem
    }
    
    getValidSpawnPosition() {
        // Basic random spawn, can be improved to avoid obstacles
        // For now, assumes player.bodyRadius is small enough or handled by initial placement
        let x, y, valid = false;
        let attempts = 0;
        const maxAttempts = 20;

        while(!valid && attempts < maxAttempts) {
            attempts++;
            x = Math.random() * MAP_WIDTH;
            y = Math.random() * MAP_HEIGHT;
            valid = true; // Assume valid initially

            // Check against map boundaries (assuming bodyRadius = 1 for simplicity here, should use actual)
            const bodyRadius = 1; // Simplified for this check, use actual player.bodyRadius
            if (x < bodyRadius || x > MAP_WIDTH - bodyRadius || y < bodyRadius || y > MAP_HEIGHT - bodyRadius) {
                valid = false;
                continue;
            }

            for (const obs of this.state.mapObstacles) {
                if (x - bodyRadius < obs.x + obs.width &&
                    x + bodyRadius > obs.x &&
                    y - bodyRadius < obs.y + obs.height &&
                    y + bodyRadius > obs.y) {
                    valid = false;
                    break;
                }
            }
        }
        if (!valid) { // Fallback if too many attempts
            console.warn("Could not find valid spawn position after max attempts, using random.");
            x = Math.random() * MAP_WIDTH;
            y = Math.random() * MAP_HEIGHT;
        }
        return { x, y };
    }


    onLeave(client, consented) {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            console.log(player.nickname, "(", client.sessionId, ") left. Consented:", consented);
            if (player.isBot) {
                this.aiBotSystem.removeBot(player.id);
            }
            this.state.players.delete(client.sessionId);

            const queueIndex = this.state.gorillaQueue.indexOf(client.sessionId);
            if (queueIndex > -1) {
                this.state.gorillaQueue.splice(queueIndex, 1);
            }

            if (this.state.gorillaPlayerId === client.sessionId) {
                this.handleGorillaLeave();
            }
        } else {
            console.log(client.sessionId, "left (player not found in state).");
        }
        console.log(`Total players: ${this.state.players.size}`);
    }

    handleChatMessage(client, message) {
        const player = this.state.players.get(client.sessionId);
        if (!player || !message || typeof message.msg !== 'string' || message.msg.trim() === "") {
            return;
        }

        const chatMsg = new ChatMessage();
        chatMsg.senderId = client.sessionId;
        chatMsg.nickname = player.nickname;
        chatMsg.message = message.msg.substring(0, 100); // Limit message length
        chatMsg.timestamp = this.clock.currentTime;

        this.state.chatMessages.push(chatMsg);
        if (this.state.chatMessages.length > MAX_CHAT_MESSAGES) {
            this.state.chatMessages.shift(); // Keep only the latest N messages
        }
        // Chat messages are part of the state, so they sync automatically.
        // No need for a separate broadcast unless specific handling is desired.
    }

    update(deltaTime) { // deltaTime is in milliseconds
        const deltaSeconds = deltaTime / 1000;
        
        // Prune old events
        const now = this.clock.currentTime;
        for (let i = this.state.events.length - 1; i >= 0; i--) {
            const event = this.state.events[i];
            // Ensure event.ts is a number before comparison
            // And that event itself is not undefined
            if (event && typeof event.ts === 'number') {
                if (now - event.ts >= 3000) { // Keep events for 3 seconds
                    this.state.events.splice(i, 1);
                }
            } else if (event === undefined || event === null) {
                // Defensive: remove undefined/null entries if they somehow appear
                this.state.events.splice(i, 1);
            }
        }

        switch (this.state.gamePhase) {
            case "lobby":
                this.updateLobby();
                break;
            case "countdown":
                this.updateCountdown(deltaSeconds);
                break;
            case "round":
                this.updateRound(deltaSeconds);
                break;
            case "results":
                this.updateResults(deltaSeconds);
                break;
        }
        // Update total human lives for HUD
        this.state.totalHumanLives = 0;
        this.state.players.forEach(p => {
            if (p.role === 'human' && p.state !== 'dead' && p.state !== 'spectating') {
                this.state.totalHumanLives += p.lives;
            }
        });
    }

    updateLobby() {
        // Try to assign gorilla if not already assigned and someone is in queue
        if (!this.state.gorillaPlayerId) {
            this.tryAssignGorilla();
        }

        // Check if we can start the game: 1 gorilla assigned, and at least 1 human player (bot or real)
        let humanPlayerCount = 0;
        this.state.players.forEach(p => {
            if (p.role === 'human' && !p.isBot) humanPlayerCount++;
        });
        
        // For MVP, let's allow starting with just a Gorilla and then bots will fill.
        // Or require at least one human player. Let's go with: Gorilla + any number of humans (bots will fill)
        if (this.state.gorillaPlayerId && this.state.players.size >= 1) { // Need at least the gorilla
             // Check if there's at least one non-bot human or if we allow starting with only bots for humans
            let realHumanPresent = false;
            this.state.players.forEach(p => {
                if (p.role === 'human' && !p.isBot) realHumanPresent = true;
            });

            // For now, let's allow starting if a gorilla is chosen, bots will fill human slots.
            // A more robust check would be:
            // (this.state.gorillaPlayerId && (humanPlayerCount > 0 || this.state.players.size >= BOT_TARGET_TOTAL_HUMANS_IF_NO_REAL_PLAYERS))
            if (this.state.gorillaPlayerId) {
                 this.startCountdown();
            }
        }
    }

    startCountdown() {
        this.state.gamePhase = "countdown";
        this.state.countdown = COUNTDOWN_SECONDS;
        this.broadcast("countdown_started", { duration: COUNTDOWN_SECONDS });
        console.log("Countdown started!");
    }

    updateCountdown(deltaSeconds) {
        this.state.countdown -= deltaSeconds;
        if (this.state.countdown <= 0) {
            this.startRound();
        }
    }

    startRound() {
        this.state.gamePhase = "round";
        this.state.roundTime = 0;
        console.log("Round started!");
        this.broadcast("round_started");

        // Reset players for the round
        this.state.players.forEach(player => {
            this.setPlayerDefaults(player); // Resets HP, lives, stamina, position
            player.state = "playing";
        });
        
        // Ensure gorilla is correctly set up
        if (this.state.gorillaPlayerId) {
            const gorilla = this.state.players.get(this.state.gorillaPlayerId);
            if (gorilla) {
                 gorilla.role = "gorilla"; // Ensure role is set
                 this.setPlayerDefaults(gorilla); // Apply gorilla defaults
            } else {
                // Gorilla player left during countdown? Promote next or end.
                console.error("Gorilla player not found at round start!");
                this.handleGorillaLeave(); // This might revert to lobby
                return; 
            }
        } else {
            console.error("No Gorilla assigned at round start!");
            // This shouldn't happen if lobby logic is correct. Revert to lobby.
            this.state.gamePhase = "lobby";
            return;
        }


        // Spawn AI bots if needed
        const activePlayersArray = Array.from(this.state.players.values());
        this.aiBotSystem.spawnBots(activePlayersArray, BOT_TARGET_TOTAL_HUMANS);
    }

    updateRound(deltaSeconds) {
        this.state.roundTime += deltaSeconds;

        // Regenerate stamina for all players
        this.state.players.forEach(player => {
            if (player.state === "playing") {
                this.staminaSystem.regenerateStamina(player, deltaSeconds);
            }
        });

        // Update AI Bots
        const gorillaPlayer = this.state.gorillaPlayerId ? this.state.players.get(this.state.gorillaPlayerId) : null;
        const activeBots = Array.from(this.state.players.values()).filter(p => p.isBot && p.state === 'playing');
        if (gorillaPlayer && gorillaPlayer.state === 'playing') {
            this.aiBotSystem.updateBots(activeBots, gorillaPlayer, this.state.mapObstacles, this.clock.currentTime);
        }


        // Check win/loss conditions
        let currentTotalHumanLives = 0;
        let aliveHumansCount = 0;
        this.state.players.forEach(p => {
            if (p.role === 'human' && p.state !== 'dead' && p.state !== 'spectating') {
                currentTotalHumanLives += p.lives;
                if (p.lives > 0) aliveHumansCount++;
            }
        });
        this.state.totalHumanLives = currentTotalHumanLives; // Update for HUD

        if (gorillaPlayer && (gorillaPlayer.hp <= 0 || gorillaPlayer.state === 'dead')) {
            this.startResultsPhase("humans_win");
            return;
        }
        if (currentTotalHumanLives <= 0 && aliveHumansCount === 0) { // Ensure all humans are truly out
            this.startResultsPhase("gorilla_wins");
            return;
        }
        if (this.state.roundTime >= ROUND_DURATION_SECONDS) {
            // Time's up! Decide winner based on remaining lives/hp (e.g., Gorilla wins if any human lives left, else draw or human win)
            // For MVP: Gorilla wins on time up if humans haven't won.
            this.startResultsPhase(currentTotalHumanLives > 0 ? "gorilla_wins_time_up" : "draw_time_up");
            return;
        }
    }

    startResultsPhase(result) {
        this.state.gamePhase = "results";
        this.state.countdown = RESULTS_DURATION_SECONDS; // Re-use countdown for results duration
        console.log("Results phase started:", result);
        this.broadcast("game_over", { result: result /*, scores: this.calculateScores() */ });
        // Scores can be derived from final player states on client, or computed here.
    }

    updateResults(deltaSeconds) {
        this.state.countdown -= deltaSeconds;
        if (this.state.countdown <= 0) {
            this.state.gamePhase = "lobby";
            this.broadcast("lobby_phase");
            console.log("Returning to lobby.");
            // Reset gorilla queue or keep it for next game? For now, keep.
            // Players remain, roles might be re-selected or kept.
            // Gorilla assignment will happen again in lobby.
            this.state.gorillaPlayerId = null; // Clear current gorilla for re-assignment
            this.state.players.forEach(p => {
                // Don't reset roles here, let them re-select or keep.
                // Resetting positions and core stats will happen at startRound.
                p.state = "playing"; // So they appear active in lobby
            });
        }
    }

    onDispose() {
        console.log("Room", this.roomId, "disposing...");
        if (this.aiBotSystem && this.aiBotSystem.bots) {
             this.aiBotSystem.bots.clear(); // Clear any bot-specific data
        }
    }
}

module.exports = { MatchRoom, GameState, Player, Obstacle, ChatMessage }; // Export GameState for potential server-side use