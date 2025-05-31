// server/systems/aiBot.js

const DEFAULT_BOT_TARGET_CHECK_INTERVAL = 200; // ms, how often a bot re-evaluates target and decides to attack
const DEFAULT_BOT_MOVE_UPDATE_INTERVAL = 100; // ms, how often a bot sends a move command

class AIBotSystem {
    /**
     * @param {object} room - Reference to the Colyseus Room instance.
     *                        Expected to have methods like:
     *                        - room.handlePlayerInput(botId, action)
     *                        - room.getValidSpawnPosition()
     *                        - room.addNewBotToState(botData) // Or similar to create bot entity
     * @param {object} balanceConfig - The game's balance configuration.
     */
    constructor(room, balanceConfig) {
        this.room = room;
        this.balance = balanceConfig;
        this.bots = new Map(); // Stores bot-specific data like last action times
        this.botTargetCheckInterval = DEFAULT_BOT_TARGET_CHECK_INTERVAL;
        this.botMoveUpdateInterval = DEFAULT_BOT_MOVE_UPDATE_INTERVAL; 
    }

    /**
     * Spawns AI bots if the current human player count is less than the desired total.
     * @param {Array<object>} allPlayers - Array of all player objects in the room's state.
     * @param {number} targetTotalHumans - The desired total number of humans (players + bots).
     */
    spawnBots(allPlayers, targetTotalHumans = 10) {
        const humanPlayers = allPlayers.filter(p => p.role === 'human' && !p.isBot);
        let botsToSpawnCount = targetTotalHumans - humanPlayers.length;

        for (let i = 0; i < botsToSpawnCount; i++) {
            const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const spawnPosition = this.room.getValidSpawnPosition ? this.room.getValidSpawnPosition() : { x: Math.random() * 100, y: Math.random() * 100 };
            
            const humanConfig = this.balance.human;
            const botData = {
                id: botId,
                isBot: true,
                role: 'human',
                x: spawnPosition.x,
                y: spawnPosition.y,
                hp: humanConfig.health,
                lives: humanConfig.lives,
                st: humanConfig.stamina,
                // Other initial states as needed, e.g., state: 'playing'
            };

            if (this.room.addNewBotToState) {
                this.room.addNewBotToState(botData); // Room adds the bot to its state
                this.bots.set(botId, { 
                    id: botId, 
                    lastAttackTime: 0, 
                    lastMoveTime: 0,
                    lastTargetCheckTime: 0 
                });
                console.log(`AIBotSystem: Spawned bot ${botId}`);
            } else {
                console.error("AIBotSystem: room.addNewBotToState is not defined. Cannot spawn bot.");
                return; // Stop spawning if room can't handle it
            }
        }
    }

    /**
     * Updates the state and actions for all AI bots.
     * @param {Array<object>} activeBots - Array of active bot player objects from the room's state.
     * @param {object|null} gorillaPlayer - The gorilla player object, or null if none.
     * @param {number} currentTime - The current server time (e.g., from room.clock.currentTime).
     */
    updateBots(activeBots, gorillaPlayer, currentTime) {
        if (!gorillaPlayer || gorillaPlayer.state === 'dead') { // Assuming 'dead' state
            // Gorilla is not present or dead, bots might wander or do nothing.
            // For MVP, they do nothing if no gorilla.
            return;
        }

        for (const bot of activeBots) {
            if (!bot.isBot || bot.state === 'dead') continue;

            const botState = this.bots.get(bot.id);
            if (!botState) {
                // If a bot exists in room state but not in our internal map, add it.
                // This could happen if bots are added by other means or after a reload.
                this.bots.set(bot.id, { 
                    id: bot.id, 
                    lastAttackTime: 0, 
                    lastMoveTime: 0,
                    lastTargetCheckTime: 0
                });
                // console.warn(`AIBotSystem: Bot ${bot.id} found in room state but not in internal map. Added.`);
                // continue; // Process next tick
            }
            
            // Simple throttle for bot decision making
            if (currentTime - botState.lastTargetCheckTime > this.botTargetCheckInterval) {
                botState.lastTargetCheckTime = currentTime;

                const dx = gorillaPlayer.x - bot.x;
                const dy = gorillaPlayer.y - bot.y;
                const distanceSq = dx * dx + dy * dy;

                // Attack logic
                const humanConfig = this.balance.human;
                const gorillaConfig = this.balance.gorilla; // Needed for gorilla's body radius
                // Assuming gorilla body radius is implicitly handled by its hit_range or a fixed value.
                // For simplicity, using human's hit_range against gorilla's center.
                // A more accurate check would be: distance < (bot.hit_range + gorilla.body_radius)
                // Spec: "Hit range (radius, units) Human: 0.9"
                // Spec: "Gorilla = filled black circle radius 3"
                const attackRange = humanConfig.hit_range + ((gorillaConfig && gorillaConfig.body_radius) || 3);


                if (distanceSq < attackRange * attackRange) {
                    // Within attack range, try to attack
                    if (this.room.handlePlayerInput) {
                         // Room will handle stamina and cooldowns via its systems
                        this.room.handlePlayerInput(bot.id, { t: 'a' });
                        botState.lastAttackTime = currentTime;
                    }
                }
            }

            // Movement logic (can be more frequent than attack decisions)
            if (currentTime - botState.lastMoveTime > this.botMoveUpdateInterval) {
                botState.lastMoveTime = currentTime;
                const dxToGorilla = gorillaPlayer.x - bot.x;
                const dyToGorilla = gorillaPlayer.y - bot.y;
                const distToGorilla = Math.sqrt(dxToGorilla * dxToGorilla + dyToGorilla * dyToGorilla);

                if (distToGorilla > 0.1) { // Avoid division by zero and tiny movements
                    const moveDx = dxToGorilla / distToGorilla;
                    const moveDy = dyToGorilla / distToGorilla;
                    if (this.room.handlePlayerInput) {
                        this.room.handlePlayerInput(bot.id, { t: 'i', dx: moveDx, dy: moveDy });
                    }
                }
            }
        }
    }

    removeBot(botId) {
        this.bots.delete(botId);
        // The room should handle removing the bot from its actual state.
        console.log(`AIBotSystem: Removed bot ${botId} from internal tracking.`);
    }
}

module.exports = AIBotSystem;