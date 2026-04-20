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
export let playerLookupMap = new Map<number, hz.Player>(); // Player ID -> latest player wrapper
export let playerPositionCache = new Map<number, hz.Vec3>(); // Player ID -> latest cached position

export function setAlivePlayers(players: hz.Player[]) {
    alivePlayers = players;
}

// HORIZON BUG WORKAROUND: Repeated world.getPlayers()/player.position.get() scans are expensive at scale.
// Keep a shared player snapshot cache so HUD and AI systems can reuse the same data instead of polling independently.
export function updatePlayerSnapshot(player: hz.Player, position: hz.Vec3): void {
    playerLookupMap.set(player.id, player);
    playerPositionCache.set(player.id, position);
}

export function removePlayerSnapshot(playerId: number): void {
    playerLookupMap.delete(playerId);
    playerPositionCache.delete(playerId);
}

export function clearPlayerSnapshots(): void {
    playerLookupMap.clear();
    playerPositionCache.clear();
}
