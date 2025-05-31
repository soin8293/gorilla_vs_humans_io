// server/systems/combat.js
const { circleRectCollision } = require('../utils/collision'); // Import the new collision utility

const DEAD_STATE = 'dead'; // Consider moving to a shared constants file or managing via Room

class CombatSystem {
    constructor(balanceConfig, respawnPlayerFn) {
        this.balance = balanceConfig;
        this.respawnPlayer = respawnPlayerFn; // Callback function like: room.respawnPlayer.bind(room)

        // Player body radii based on spec. Assumes these might be added to balance.json for configurability.
        // Gorilla: "filled black circle radius 3"
        // Human: "filled colored circle radius 1"
        this.playerBodyRadii = {
            gorilla: (this.balance.gorilla && this.balance.gorilla.body_radius) || 3,
            human: (this.balance.human && this.balance.human.body_radius) || 1
        };
    }

    /**
     * Handles an attack action from an attacker.
     * Performs hit detection against all other players in the room.
     * Applies damage and effects for any successful hits.
     * Returns an array of event objects for broadcasting.
     * Expected player object structure: { id, x, y, role, hp, lives, state }
     */
    handleAttackAction(attacker, allPlayersInRoom) {
        if (!attacker || attacker.state === DEAD_STATE) {
            return []; // Attacker is invalid or dead
        }

        const events = [];
        const attackerPosition = { x: attacker.x, y: attacker.y };
        // Hit range from balance.json is treated as the radius of the punch/attack effect area.
        const attackerPunchRadius = attacker.role === 'gorilla' ? this.balance.gorilla.hit_range : this.balance.human.hit_range;

        for (const target of allPlayersInRoom) {
            if (!target || target.id === attacker.id || target.state === DEAD_STATE) {
                continue; // Skip self, invalid targets, or dead targets
            }

            const targetPosition = { x: target.x, y: target.y };
            const targetBodyRadius = this.playerBodyRadii[target.role];

            if (typeof attackerPosition.x !== 'number' || typeof attackerPosition.y !== 'number' ||
                typeof targetPosition.x !== 'number' || typeof targetPosition.y !== 'number' ||
                typeof attackerPunchRadius !== 'number' || typeof targetBodyRadius !== 'number') {
                console.error("Invalid position or radius data for hit detection:", { attacker, target });
                continue;
            }

            // For hit detection, the "attacker" is a circle (their punch range)
            // and the "target" is a circle (their body).
            // We are checking if the attacker's punch circle overlaps the target's body circle.
            // The combat system doesn't directly interact with rectangular obstacles for hit detection,
            // but the circleRectCollision could be used if attacks could hit obstacles or had rectangular hitboxes.
            // Here, it's circle-circle collision.

            const dx = attackerPosition.x - targetPosition.x;
            const dy = attackerPosition.y - targetPosition.y;
            const distanceSq = dx * dx + dy * dy;
            
            // Collision if distance between centers is less than sum of punch radius and target body radius
            const combinedRadius = attackerPunchRadius + targetBodyRadius;

            if (distanceSq < combinedRadius * combinedRadius) {
                // Hit detected!
                // The _applyDamageAndEffects method expects event data in a specific array format.
                // We need to ensure the returned events are structured correctly for MatchRoom.js GameEvent schema.
                const damageOutcomeEvents = this._applyDamageAndEffects(attacker, target);
                if (damageOutcomeEvents && damageOutcomeEvents.length > 0) {
                    // Convert to the [type, ...args] format expected by MatchRoom's old event style,
                    // which then gets converted to GameEvent objects.
                    // OR, directly return objects that MatchRoom can easily map to GameEvent.
                    // Let's adapt to return data that MatchRoom's current GameEvent creation logic can use.
                    damageOutcomeEvents.forEach(eventArray => {
                        // eventArray is like ['hit', attacker.id, victim.id, damageDealt, isCrit, victim.nickname, attacker.nickname]
                        // or ['kill', killer.id, victim.id, reason, victim.nickname, killer.nickname]
                        // or ['respawn', victim.id, livesRemaining, victim.nickname]
                        
                        // The MatchRoom's handlePlayerInput already expects this array format from combatSystem.
                        // So, no change needed here for the structure of `damageOutcomeEvents`.
                        // The change is that MatchRoom will now create structured GameEvent objects from these arrays.
                        events.push(eventArray);
                    });
                }
            }
        }
        return events;
    }

    /**
     * (Internal) Processes damage and effects from an attacker to a victim.
     * Modifies victim's state (hp, lives, state) directly.
     * Returns an array of event objects according to spec format.
     */
    _applyDamageAndEffects(attacker, victim) {
        let eventLog = [];

        if (attacker.role === 'gorilla' && victim.role === 'human') {
            const humanBalance = this.balance.human;
            const gorillaBalance = this.balance.gorilla;
            const critChance = humanBalance.crit_kill_pct / 100;
            const nonCritDamage = gorillaBalance.gorilla_nocrit_damage; // Should be 3
            const maxHpForNewLife = humanBalance.health; // Should be 10

            if (Math.random() < critChance) {
                // Calculate total damage for crit: current HP + HP of all remaining full lives
                const damageDealt = victim.hp + (victim.lives > 0 ? (victim.lives -1) * maxHpForNewLife : 0);
                victim.lives = 0;
                victim.hp = 0;
                victim.state = DEAD_STATE;
                // eventLog.push(['hit', attacker.id, victim.id, damageDealt, true]); // Old format
                eventLog.push(['hit', attacker.id, victim.id, damageDealt, true, victim.nickname, attacker.nickname]);
                // eventLog.push(['kill', attacker.id, victim.id, 'gorilla_crit']); // Old format
                eventLog.push(['kill', attacker.id, victim.id, 'gorilla_crit', victim.nickname, attacker.nickname]);
            } else {
                victim.hp -= nonCritDamage;
                // eventLog.push(['hit', attacker.id, victim.id, nonCritDamage, false]); // Old format
                eventLog.push(['hit', attacker.id, victim.id, nonCritDamage, false, victim.nickname, attacker.nickname]);

                if (victim.hp <= 0) {
                    victim.lives--;
                    if (victim.lives > 0) {
                        victim.hp = maxHpForNewLife; // Reset HP for the new life
                        if (this.respawnPlayer) {
                            this.respawnPlayer(victim); // External function to handle respawn logic
                        }
                        // eventLog.push(['respawn', victim.id, victim.lives]); // Old format
                        eventLog.push(['respawn', victim.id, victim.lives, victim.nickname]);
                    } else {
                        // No lives left
                        victim.hp = 0; // Ensure HP is zero
                        victim.state = DEAD_STATE;
                        // eventLog.push(['kill', attacker.id, victim.id, 'gorilla_damage']); // Old format
                        eventLog.push(['kill', attacker.id, victim.id, 'gorilla_damage', victim.nickname, attacker.nickname]);
                    }
                }
            }
        } else if (attacker.role === 'human' && victim.role === 'gorilla') {
            const gorillaBalance = this.balance.gorilla;
            const humanBalance = this.balance.human;
            // Assumes human.damage_to_gorilla might be added to balance.json, defaults to 1
            const nonCritDamage = (humanBalance && humanBalance.damage_to_gorilla) || 1; 
            const critChance = gorillaBalance.crit_kill_pct / 100; // Currently 0% in balance.json

            if (Math.random() < critChance) { // This branch is effectively disabled if crit_kill_pct is 0
                const damageDealt = victim.hp; // Gorilla's remaining HP
                victim.hp = 0;
                // Gorilla has 1 life, so hp 0 means death.
                victim.state = DEAD_STATE;
                // eventLog.push(['hit', attacker.id, victim.id, damageDealt, true]); // Old format
                eventLog.push(['hit', attacker.id, victim.id, damageDealt, true, victim.nickname, attacker.nickname]);
                // eventLog.push(['kill', attacker.id, victim.id, 'human_crit']); // Old format
                eventLog.push(['kill', attacker.id, victim.id, 'human_crit', victim.nickname, attacker.nickname]);
            } else {
                victim.hp -= nonCritDamage;
                // eventLog.push(['hit', attacker.id, victim.id, nonCritDamage, false]); // Old format
                eventLog.push(['hit', attacker.id, victim.id, nonCritDamage, false, victim.nickname, attacker.nickname]);

                if (victim.hp <= 0) {
                    victim.hp = 0; // Ensure HP is zero
                    victim.state = DEAD_STATE;
                    // eventLog.push(['kill', attacker.id, victim.id, 'human_damage']); // Old format
                    eventLog.push(['kill', attacker.id, victim.id, 'human_damage', victim.nickname, attacker.nickname]);
                }
            }
        }
        return eventLog;
    }
}

module.exports = CombatSystem;