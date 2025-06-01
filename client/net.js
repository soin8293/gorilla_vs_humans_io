// net.js (ES module)
// client/net.js  (top of file)
const client = new Colyseus.Client("wss://gorilla-vs-humans-io.onrender.com");
window.colyseusRoom = null; // Expose room globally for game.js to send inputs

// gameState will be populated by server updates and consumed by game.js
export const gameState = {
    players: new Map(),
    obstacles: [], // Assuming obstacles are static or sent once
    gamePhase: "connecting", // e.g., "lobby", "countdown", "active", "results"
    countdown: 0,
    roundTime: 0,
    totalHumanLives: 0,
    localPlayerId: null,
    events: [], // This will be an array of event objects from the server {id, ts, type, ...data}
    mapDimensions: { width: 800, height: 600 } // Default, should be updated by server
};

const processedEventIds = new Set();

export function dequeueEvents() {
    const newEvents = [];
    // gameState.events is directly from server state, which is an ArraySchema.
    // We need to iterate it carefully.
    if (gameState.events && gameState.events.forEach) {
        gameState.events.forEach(event => {
            if (event && event.id && !processedEventIds.has(event.id)) {
                processedEventIds.add(event.id);
                newEvents.push(event); // Push the actual event object
            }
        });
    }
    // The server prunes events after 3s. Client-side `processedEventIds` ensures
    // each event is acted upon once, even if it's received in multiple state updates
    // before server pruning. We don't need to prune `processedEventIds` aggressively
    // unless memory becomes an issue, as event IDs are unique and old ones won't reappear.
    // For very long sessions, some pruning of `processedEventIds` might be good.
    if (processedEventIds.size > 200) { // Example pruning condition
        // Convert set to array, take the first N, and delete them
        const idsToDelete = Array.from(processedEventIds).slice(0, 100);
        idsToDelete.forEach(id => processedEventIds.delete(id));
    }
    return newEvents;
}

// Function to get/set nickname from localStorage
function getPlayerNickname() {
    let nickname = localStorage.getItem('playerNickname');
    if (!nickname) {
        nickname = prompt("Enter your nickname:", "Player" + Math.floor(Math.random() * 100));
        if (nickname) {
            localStorage.setItem('playerNickname', nickname);
        } else {
            nickname = "AnonPlayer" + Math.floor(Math.random() * 100);
        }
    }
    return nickname;
}


async function connect() {
    try {
        const nickname = getPlayerNickname();
        const room = await client.joinOrCreate("game_room", { nickname: nickname });
        window.colyseusRoom = room;
        gameState.localPlayerId = room.sessionId;
        console.log("Joined successfully!", room.sessionId, room.name);

        // Initial state might contain static elements like obstacles
        if (room.state.obstacles) {
            gameState.obstacles = Array.from(room.state.obstacles); // Assuming obstacles is an ArraySchema
        }
        if (room.state.mapWidth && room.state.mapHeight) {
            gameState.mapDimensions = { width: room.state.mapWidth, height: room.state.mapHeight };
        }


        // Listen to state changes
        room.onStateChange((state) => {
            // console.log("Full state update:", JSON.parse(JSON.stringify(state)));
            if (state.players) {
                gameState.players.clear();
                state.players.forEach((player, sessionId) => {
                    gameState.players.set(sessionId, player);
                });
            }
            if (state.obstacles && gameState.obstacles.length === 0) { // Only set once if not already set
                 gameState.obstacles = Array.from(state.obstacles);
            }
            if (state.mapWidth && state.mapHeight) {
                gameState.mapDimensions = { width: state.mapWidth, height: state.mapHeight };
            }

            gameState.gamePhase = state.gamePhase !== undefined ? state.gamePhase : gameState.gamePhase;
            gameState.countdown = state.countdown !== undefined ? state.countdown : gameState.countdown;
            gameState.roundTime = state.roundTime !== undefined ? state.roundTime : gameState.roundTime;
            gameState.totalHumanLives = state.totalHumanLives !== undefined ? state.totalHumanLives : gameState.totalHumanLives;
            
            // Server now handles event pruning. Client just consumes.
            if (state.events) {
                // gameState.events should directly reference or be a copy of state.events
                // The server sends GameEvent objects. Colyseus ArraySchema handles the sync.
                // We just need to make sure gameState.events is the up-to-date array.
                gameState.events = state.events;
            }
        });
        
        // No need for explicit onAdd/onRemove for players if onStateChange handles the full player list.
        // Server events are now part of the main state.events array.
        // Custom messages can still be used for things not fitting into state.
        room.onMessage("*", (type, message) => {
            console.log("Received message:", type, message);
            // Example: if server sends a direct chat message or a specific non-state event
            if (type === "chat_message" && window.addChatMessage) {
                window.addChatMessage(message.sender, message.text);
            }
            // The P1 requirement for events (hit, kill, respawn, etc.) will be handled by `state.events`
            // and processed in game.js based on their `type` and `ts`.
        });

        room.onError((code, message) => {
            console.error("Colyseus room error:", code, message);
            alert(`Connection error: ${message} (code ${code})`);
        });

        room.onLeave((code) => {
            console.log("Left room, code:", code);
            window.colyseusRoom = null;
            gameState.gamePhase = "disconnected";
            // Optionally, clear other parts of gameState or redirect
        });

    } catch (e) {
        console.error("JOIN ERROR", e);
        alert("Could not connect to the server. Please ensure it's running and accessible. Check console for details.");
        gameState.gamePhase = "error";
    }
}

// Auto-connect on load
connect();

// Expose a function to send input to the server
export function sendInput(type, payload) {
    if (window.colyseusRoom && window.colyseusRoom.connection) {
        window.colyseusRoom.send(type, payload);
    }
}

// Expose a function to send chat messages
export function sendChatMessage(messageText) {
    if (window.colyseusRoom && messageText.trim() !== "") {
        window.colyseusRoom.send("chat_message", { text: messageText });
    }
}