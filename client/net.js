const client = new Colyseus.Client('ws://localhost:2567');
window.colyseusRoom = null; // Expose room globally for game.js to send inputs

async function connect() {
    try {
        const nickname = prompt("Enter your nickname:", "Player" + Math.floor(Math.random() * 100)) || "AnonPlayer";
        // Attempt to join "MatchRoom". The server's index.js likely registers MatchRoom with this name.
        const room = await client.joinOrCreate("MatchRoom", { nickname: nickname });
        window.colyseusRoom = room;
        console.log("Joined successfully!", room.sessionId, room.name);

        if (window.setLocalPlayerId) {
            window.setLocalPlayerId(room.sessionId);
        }

        // Listen to state changes
        room.onStateChange((state) => {
            // console.log("State change:", state);
            if (state.players && window.updatePlayers) {
                // The server's GameState has players as a MapSchema
                // We need to pass it to game.js, which expects an object or can iterate it.
                // For simplicity, game.js's updatePlayers can handle the MapSchema directly.
                window.updatePlayers(state.players);
            }
        });

        // Handling player additions and removals if not covered by onStateChange's full sync
        // Colyseus MapSchema typically triggers onStateChange for adds/removals.
        // However, explicit listeners can be useful for specific events or debugging.

        room.state.players.onAdd((player, sessionId) => {
            console.log("Player added:", sessionId, player);
            // updatePlayers will be called by onStateChange, but if specific logic is needed on add:
            // if (window.updatePlayers) window.updatePlayers(room.state.players);
        });

        room.state.players.onRemove((player, sessionId) => {
            console.log("Player removed:", sessionId);
            if (window.removePlayer) {
                window.removePlayer(sessionId);
            }
            // if (window.updatePlayers) window.updatePlayers(room.state.players);
        });
        
        room.onMessage("*", (type, message) => {
            console.log("Received message:", type, message);
            if (type === "welcome" && message.yourId) {
                 if (window.setLocalPlayerId) {
                    window.setLocalPlayerId(message.yourId);
                }
            }
            // Handle other custom messages from the server if needed
            // e.g., game_over, countdown_started
        });


        room.onError((code, message) => {
            console.error("Colyseus room error:", code, message);
        });

        room.onLeave((code) => {
            console.log("Left room, code:", code);
            window.colyseusRoom = null;
        });

    } catch (e) {
        console.error("JOIN ERROR", e);
        alert("Could not connect to the server. Please ensure it's running and accessible.");
    }
}

// Auto-connect on load
connect();