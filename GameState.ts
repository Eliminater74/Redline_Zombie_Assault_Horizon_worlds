import * as hz from 'horizon/core';

/**
 * ============================================================================
 * GAME STATE
 * ============================================================================
 * Centralized state container for shared game data.
 * Used to decouple major systems (PlayerManager, Zombie, etc.) to prevent circular dependencies.
 */

// --- PLAYER STATE ---
export let alivePlayers: hz.Player[] = [];
export let alivePlayerIds = new Set<number>(); // O(1) lookups for performance
export let ignoredPlayerIds = new Set<number>(); // Players ignored by AI (Soft AFK)
export let playerHealthMap = new Map<number, number>(); // Player ID -> Health (0-10) for AI targeting

export function setAlivePlayers(players: hz.Player[]) {
    alivePlayers = players;
}
