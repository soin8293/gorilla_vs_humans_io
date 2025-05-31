// server/systems/aiBot.js
const { circleRectCollision } = require('../utils/collision'); // For obstacle avoidance

const DEFAULT_BOT_TARGET_CHECK_INTERVAL = 200; // ms, how often a bot re-evaluates target and decides to attack
const DEFAULT_BOT_MOVE_UPDATE_INTERVAL = 100; // ms, how often a bot sends a move command
const FLEE_HP_THRESHOLD = 3;
const OBSTACLE_AVOID_DISTANCE = 2; // How far ahead to check for obstacles (in player bodyRadius units)

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
     * @param {ArraySchema<Obstacle>} obstacles - The map obstacles from room state.
     * @param {number} currentTime - The current server time (e.g., from room.clock.currentTime).
     */
    updateBots(activeBots, gorillaPlayer, obstacles, currentTime) {
        for (const bot of activeBots) {
            if (!bot.isBot || bot.state === 'dead') continue;

            let botState = this.bots.get(bot.id);
            if (!botState) {
                botState = { id: bot.id, lastAttackTime: 0, lastMoveTime: 0, lastTargetCheckTime: 0 };
                this.bots.set(bot.id, botState);
            }

            let targetX = bot.x;
            let targetY = bot.y;
            let fleeing = false;
            let engageTarget = gorillaPlayer; // By default, human bots target the gorilla

            // Fleeing logic
            if (bot.hp <= FLEE_HP_THRESHOLD) {
                fleeing = true;
                if (engageTarget && engageTarget.state !== 'dead') {
                    // Flee directly away from the primary target (gorilla)
                    targetX = bot.x - (engageTarget.x - bot.x);
                    targetY = bot.y - (engageTarget.y - bot.y);
                } else {
                    fleeing = false; // No valid target to flee from
                }
            }

            // Regular targeting if not fleeing and a valid target exists
            if (!fleeing && engageTarget && engageTarget.state !== 'dead') {
                targetX = engageTarget.x;
                targetY = engageTarget.y;

                // Attack logic (throttled)
                if (currentTime - botState.lastTargetCheckTime > this.botTargetCheckInterval) {
                    botState.lastTargetCheckTime = currentTime;
                    const dxAttack = targetX - bot.x;
                    const dyAttack = targetY - bot.y;
                    const distSqAttack = dxAttack * dxAttack + dyAttack * dyAttack;
                    
                    const attackerConfig = this.balance[bot.role]; // e.g., human
                    const targetConfig = this.balance[engageTarget.role]; // e.g., gorilla
                    
                    const attackRange = (attackerConfig.hit_range || 0.9) + (targetConfig.body_radius || 3);

                    if (distSqAttack < attackRange * attackRange) {
                        if (this.room.handlePlayerInput) {
                            this.room.handlePlayerInput(bot.id, { t: 'a' });
                            botState.lastAttackTime = currentTime;
                        }
                    }
                }
            } else if (!fleeing) { // Not fleeing, but no valid target
                if (this.room.handlePlayerInput) {
                     this.room.handlePlayerInput(bot.id, { t: 'i', dx: 0, dy: 0 }); // Stop
                }
                continue; // No further movement logic if no target and not fleeing
            }

            // Movement logic (throttled)
            if (currentTime - botState.lastMoveTime > this.botMoveUpdateInterval) {
                botState.lastMoveTime = currentTime;
                let moveDx = targetX - bot.x;
                let moveDy = targetY - bot.y;
                const distToTarget = Math.sqrt(moveDx * moveDx + moveDy * moveDy);

                if (distToTarget > 0.1) { // Avoid division by zero and tiny movements
                    moveDx /= distToTarget;
                    moveDy /= distToTarget;

                    // Obstacle Avoidance
                    const lookAheadDist = (bot.bodyRadius || 1) * OBSTACLE_AVOID_DISTANCE;
                    const checkX = bot.x + moveDx * lookAheadDist;
                    const checkY = bot.y + moveDy * lookAheadDist;

                    let impendingCollision = false;
                    if (obstacles && obstacles.length > 0) {
                        for (const obs of obstacles) {
                            if (circleRectCollision(checkX, checkY, (bot.bodyRadius || 1), obs.x, obs.y, obs.width, obs.height)) {
                                impendingCollision = true;
                                break;
                            }
                        }
                    }

                    if (impendingCollision) {
                        // Simple sidestep: rotate current movement vector by +/- 90 degrees randomly
                        const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
                        const newMoveDx = moveDx * Math.cos(angle) - moveDy * Math.sin(angle);
                        const newMoveDy = moveDx * Math.sin(angle) + moveDy * Math.cos(angle);
                        moveDx = newMoveDx;
                        moveDy = newMoveDy;
                    }
                    
                    if (this.room.handlePlayerInput) {
                        this.room.handlePlayerInput(bot.id, { t: 'i', dx: moveDx, dy: moveDy });
                    }
                } else if (fleeing && distToTarget <= 0.1) {
                     if (this.room.handlePlayerInput) { // If fleeing and "reached" flee direction (effectively stopped), stop sending input
                        this.room.handlePlayerInput(bot.id, { t: 'i', dx: 0, dy: 0 });
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