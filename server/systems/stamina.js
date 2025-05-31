// server/systems/stamina.js

class StaminaSystem {
    constructor(balanceConfig) {
        this.balance = balanceConfig;
    }

    /**
     * Attempts to consume stamina for a player's action.
     * Player object is expected to have `role` and `st` (current stamina) properties.
     * @param {object} player - The player object (e.g., { id: 'abc', role: 'human', st: 50 })
     * @returns {boolean} - True if stamina was sufficient and consumed, false otherwise.
     */
    consumeStamina(player) {
        if (!player || !player.role || typeof player.st !== 'number') {
            console.error("StaminaSystem.consumeStamina: Invalid player object or missing 'st' property.", player);
            return false;
        }

        const roleConfig = this.balance[player.role];
        if (!roleConfig || typeof roleConfig.stamina_per_punch !== 'number') {
            console.error(`StaminaSystem.consumeStamina: Missing 'stamina_per_punch' for role ${player.role} in balance config.`, roleConfig);
            return false;
        }

        const cost = roleConfig.stamina_per_punch;

        if (player.st >= cost) {
            player.st -= cost;
            return true;
        }
        return false;
    }

    /**
     * Regenerates stamina for a player based on elapsed time.
     * Player object is expected to have `role` and `st` (current stamina) properties.
     * @param {object} player - The player object (e.g., { id: 'abc', role: 'human', st: 30 })
     * @param {number} deltaTimeInSeconds - The time elapsed since the last regeneration.
     * @returns {number} - The player's new stamina value (player.st is updated directly).
     */
    regenerateStamina(player, deltaTimeInSeconds) {
        if (!player || !player.role || typeof player.st !== 'number') {
            console.error("StaminaSystem.regenerateStamina: Invalid player object or missing 'st' property.", player);
            return player && typeof player.st === 'number' ? player.st : 0;
        }
        if (typeof deltaTimeInSeconds !== 'number' || deltaTimeInSeconds <= 0) {
            return player.st; // No time passed or invalid delta
        }

        const roleConfig = this.balance[player.role];
        // 'stamina' in balance.json refers to the max stamina pool for that role.
        if (!roleConfig || typeof roleConfig.regen_per_sec !== 'number' || typeof roleConfig.stamina !== 'number') {
            console.error(`StaminaSystem.regenerateStamina: Missing 'regen_per_sec' or max 'stamina' for role ${player.role} in balance config.`, roleConfig);
            return player.st;
        }

        const maxStaminaForRole = roleConfig.stamina; 
        const regenRatePerSecond = roleConfig.regen_per_sec;
        
        if (player.st < maxStaminaForRole) {
            const amountToRegen = regenRatePerSecond * deltaTimeInSeconds;
            player.st += amountToRegen;
            if (player.st > maxStaminaForRole) {
                player.st = maxStaminaForRole;
            }
        }
        // Stamina can be fractional, which is fine for smooth regeneration.
        // If integer stamina is strictly required, uncomment:
        // player.st = Math.floor(player.st); 
        return player.st;
    }
}

module.exports = StaminaSystem;