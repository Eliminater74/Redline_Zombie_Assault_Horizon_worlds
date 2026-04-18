import * as hz from 'horizon/core';

/**
 * ============================================================================
 * ZOMBIE UPDATE MANAGER
 * ============================================================================
 *
 * OPTIMIZATION: Centralizes the frame update loop for all zombies.
 *
 * PROBLEM SOLVED:
 * Previously, each zombie registered its own hz.World.onUpdate listener.
 * With 15 zombies at 60 FPS, that's 900+ function calls per second just
 * for the entry check, even with internal throttling.
 *
 * SOLUTION:
 * This manager holds a SINGLE onUpdate hook and iterates all registered
 * zombies in one loop. Reduces 900+ calls/sec down to ~60 calls/sec.
 *
 * USAGE:
 * - Zombies call ZombieUpdateManager.register(zombie) on revive
 * - Zombies call ZombieUpdateManager.unregister(zombie) on death
 * - The manager calls zombie.update() each frame
 */

/**
 * Interface for objects that can be updated by the manager.
 * Zombies must implement this interface to be registered.
 */
export interface IUpdatable {
    /** Called each frame by the manager */
    update(): void;
    /** Unique identifier for deduplication (bigint for Horizon entity IDs) */
    getId(): bigint;
}

// ============================================================================
// MODULE-LEVEL REGISTRY (Avoids static property conflicts with hz.Component)
// ============================================================================

// ============================================================================
// MODULE-LEVEL REGISTRY (Avoids static property conflicts with hz.Component)
// ============================================================================

/** Map of all registered updatable zombies (Key: Entity ID) */
const zombieRegistry: Map<bigint, IUpdatable> = new Map();

/** Flag to prevent duplicate initialization */
let isInitialized: boolean = false;

// ============================================================================
// PUBLIC API (Called by Zombie.ts)
// ============================================================================

/**
 * Registers a zombie to receive update() calls each frame.
 * Call this when a zombie is revived/spawned.
 *
 * @param updatable - The zombie implementing IUpdatable interface
 */
export function registerZombie(updatable: IUpdatable): void {
    // Deduplication by Entity ID
    const id = updatable.getId();
    if (zombieRegistry.has(id)) {
        // console.warn(`[ZombieUpdateManager] Zombie ${id} already registered. Overwriting.`);
    }
    zombieRegistry.set(id, updatable);
}

/**
 * Unregisters a zombie from the update loop.
 * Call this when a zombie dies or is unloaded.
 *
 * @param updatable - The zombie to remove from updates
 */
export function unregisterZombie(updatable: IUpdatable): void {
    // Robust unregistration by ID
    try {
        const id = updatable.getId();
        zombieRegistry.delete(id);
    } catch (e) {
        // Fallback or ignore if ID access fails
    }
}

/**
 * Returns the current number of registered zombies.
 * Useful for debugging/monitoring.
 */
export function getRegisteredCount(): number {
    return zombieRegistry.size;
}

/**
 * Clears all registered zombies.
 * Call this on game end to ensure clean state.
 */
export function clearAllZombies(): void {
    zombieRegistry.clear();
}

// ============================================================================
// ZOMBIE UPDATE MANAGER COMPONENT
// ============================================================================

/**
 * Component that drives the centralized zombie update loop.
 * Attach this script to any persistent object in the world (e.g., GameManager).
 * Only ONE instance should exist in the world.
 */
class ZombieUpdateManager extends hz.Component<typeof ZombieUpdateManager> {
    static propsDefinition = {};

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /**
     * Called when the component starts.
     * Connects the single onUpdate hook that drives all zombie updates.
     */
    start(): void {
        // Prevent duplicate managers from running
        if (isInitialized) {
            console.warn("[ZombieUpdateManager] Duplicate instance detected, skipping initialization.");
            return;
        }

        isInitialized = true;

        // Connect the SINGLE frame update hook
        // This replaces 15+ individual hooks with just one
        this.connectLocalBroadcastEvent(hz.World.onUpdate, this.onFrameUpdate.bind(this));

        console.log("[ZombieUpdateManager] Initialized - Centralized update loop active.");
    }

    // =========================================================================
    // FRAME UPDATE LOOP
    // =========================================================================

    /**
     * Called every frame by hz.World.onUpdate.
     * Iterates all registered zombies and calls their update() method.
     *
     * PERFORMANCE NOTE:
     * This single loop replaces N separate onUpdate listeners.
     * The overhead of iterating a Map is negligible compared to
     * the cost of N separate event dispatches.
     */
    private onFrameUpdate(): void {
        // Iterate all registered zombies and call their update
        zombieRegistry.forEach((updatable) => {
            try {
                updatable.update();
            } catch (e) {
                // If a zombie's update fails, log but don't break the loop
                // This prevents one broken zombie from stopping all updates
                console.error("[ZombieUpdateManager] Update failed for zombie:", e);
                // Auto-remove broken zombies? Maybe safer to leave them unless they error repeatedly.
                // For now, let Zombie.ts handle self-unregistration on error.
            }
        });
    }
}

// Register the component with Horizon
hz.Component.register(ZombieUpdateManager);
