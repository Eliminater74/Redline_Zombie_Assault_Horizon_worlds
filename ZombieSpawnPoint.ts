import * as hz from 'horizon/core';
import { Events } from 'Events';

const QUEUE_TICK_MS = 100;
const MIN_SPAWN_INTERVAL_MS = 100; // Reduced from 220ms — allows spawn points to process queue faster

// Global registry
export const spawnLocations: hz.Entity[] = [];

/**
 * Efficient zombie spawn-queue processor.
 * Ensures zombies spawn at proper spacing and avoids stacking.
 */
class ZombieSpawnPoint extends hz.Component<typeof ZombieSpawnPoint> {
  static propsDefinition = {};

  /** Queue of zombies waiting for this spawn point */
  private zombieQueue: { zombie: hz.Entity, health: number, speed: number, wave: number }[] = [];
  private lastSpawnTime = 0;
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store handle to cancel in cleanup().
  private queueInterval: number | null = null;
  // INVISIBLE ZOMBIE FIX: Tracked handles for delayed reviveZombie broadcasts.
  // Each processed zombie schedules its revive 200ms after position is set, giving
  // Horizon time to replicate the entity's position to clients before they receive
  // the reviveZombie event and try to initialize the component.
  private pendingReviveTimers: number[] = [];

  preStart(): void {
    // Listen for zombies being assigned to this spawn point
    this.connectLocalEvent(
      this.entity,
      Events.queueZombie, // Note: Ensure your Manager sends this to add to queue
      this.queueZombie.bind(this)
    );
  }

  start(): void {
    // FIX 1: Prevent duplicates in the global array
    if (!spawnLocations.includes(this.entity)) {
      spawnLocations.push(this.entity);
    }

    // Repeatedly process spawn queue
    this.queueInterval = this.async.setInterval(() => this.processQueue(), QUEUE_TICK_MS);
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.queueInterval !== null) {
      this.async.clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
    // Cancel any pending reviveZombie broadcasts so they don't fire on a dead component.
    for (const t of this.pendingReviveTimers) this.async.clearTimeout(t);
    this.pendingReviveTimers = [];
  }

  /**
   * Cleanup when object is destroyed or script stops.
   * Prevents "Ghost" spawn points in your global array.
   */
  preDestroy(): void {
    const index = spawnLocations.indexOf(this.entity);
    if (index > -1) {
      spawnLocations.splice(index, 1);
    }
  }

  /**
   * Add a zombie to this spawn point’s queue
   */
  private queueZombie(data: { zombie: hz.Entity, health: number, speed: number, wave: number }) {
    if (data.zombie) {
      // FIX 2: Prevent adding the exact same zombie twice if event fires double.
      // HORIZON BUG WORKAROUND: Entity wrappers from different call sites are different
      // JS objects for the same entity — reference equality (===) always returns false.
      // Use entity.id (bigint) for reliable identity checks.
      if (!this.zombieQueue.find(item => item.zombie.id === data.zombie.id)) {
         this.zombieQueue.push(data);
         this.processQueue();
      }
    }
  }

  /**
   * Safely spawn the next zombie in the queue.
   */
  private processQueue(): void {
    if (this.zombieQueue.length === 0) return;

    const now = Date.now();
    if (now - this.lastSpawnTime < MIN_SPAWN_INTERVAL_MS) return;

    // FIX: Validate this spawn point entity is still valid
    try {
        if (!this.entity.isValidReference.get()) return;
    } catch (e) { return; }

    // Peek at the first zombie (don't shift yet)
    const item = this.zombieQueue[0];
    const zombie = item.zombie;

    // SAFETY CHECK: Ensure zombie entity is valid before doing anything
    const isValid = this.isEntityValid(zombie);

    // Always shift to remove it from queue, even if invalid (so we don't get stuck)
    this.zombieQueue.shift();

    // FIX: Skip processing if zombie entity is invalid
    if (!isValid) return;

    try {
        // Move zombie to spawn point
        // FIX: Exact position of the Gizmo. No jitter.
        // The WaveManager ensures no two zombies spawn here at once.
        const spawnPos = this.entity.position.get();

        zombie.position.set(spawnPos);

        // TWEAK: Randomize Y rotation slightly so they don't all look identical
        // (Optional: remove if you want strict facing)
        const currentRot = this.entity.rotation.get();
        zombie.rotation.set(currentRot);

        this.lastSpawnTime = now;

        // INVISIBLE ZOMBIE FIX: Delay the reviveZombie broadcast by 200ms to give
        // Horizon time to replicate the entity's new position to all clients before
        // they receive the event and attempt to initialize the Zombie component.
        // Clients that receive reviveZombie before their entity is replicated get a
        // failed isValidReference check and silently skip initialization, producing
        // an invisible (or non-AI) zombie. The delay dramatically reduces that window.
        const capturedItem = item;
        const capturedPos = spawnPos;
        let reviveTimer: number;
        reviveTimer = this.async.setTimeout(() => {
          const idx = this.pendingReviveTimers.indexOf(reviveTimer);
          if (idx > -1) this.pendingReviveTimers.splice(idx, 1);
          this.sendNetworkBroadcastEvent(Events.reviveZombie, {
            zombie: capturedItem.zombie,
            health: capturedItem.health,
            speed: capturedItem.speed,
            wave: capturedItem.wave,
            position: capturedPos
          });
        }, 200);
        this.pendingReviveTimers.push(reviveTimer);
    } catch (e) { /* Ignore entity errors */ }
  }

  /**
   * Helper to safely check if an entity exists/is loaded
   */
  private isEntityValid(ent: hz.Entity): boolean {
    try {
      // FIX: Use proper isValidReference check
      return !!ent && ent.isValidReference.get();
    } catch {
      return false;
    }
  }
}

hz.Component.register(ZombieSpawnPoint);
export default ZombieSpawnPoint;
