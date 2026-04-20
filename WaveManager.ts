import * as hz from 'horizon/core';
import { Events } from 'Events';
import { GameConfig } from 'GameConfig';
import { SpawnManager } from 'SpawnManager';
import { PersistenceManager } from 'PersistenceManager';

// ============================================================================
// WAVE MANAGER
// ============================================================================
// Handles zombie spawning, wave progression, and difficulty scaling.
// Uses object pooling via SpawnController for Quest performance.
// ============================================================================

/**
 * Current wave number (exported for other scripts to read).
 */
export let wave: number = 1;

// ============================================================================
// DIFFICULTY SCALING CONSTANTS
// ============================================================================

/** Starting health for zombies on wave 1 */
const initHealth = 100;

/** 
 * Starting speed for zombies on wave 1.
 * BALANCE CHANGE: Reduced from 1.5 to 1.2 based on player feedback
 * (zombies were moving too fast)
 */
const initSpeed = 1.2;

/** Health multiplier applied each wave (10% increase) */
const healthIncrease = 1.1;

/** 
 * Speed multiplier applied each wave.
 * BALANCE CHANGE: Reduced from 1.05 to 1.03 for gentler scaling
 */
const SpeedIncrease = 1.03;

/** 
 * Maximum zombie speed (capped to prevent impossible gameplay).
 * BALANCE CHANGE: Reduced from 7.0 to 4.5 based on player feedback
 */
const maxSpeed = 4.5;

/** Maximum zombie health (prevents bullet-sponge zombies) */
const maxHealth = 450;

/** Additional zombies spawned per wave (base = wave * spawnIncrease) */
const spawnIncrease = 3;

/** 
 * Maximum concurrent active zombies.
 * This is the pool size - we never have more than this many zombies loaded.
 * Keeps Quest performance stable.
 */
const MAX_CONCURRENT_ZOMBIES = 15;


/**
 * Maximum ammo pickups allowed on the ground at once.
 * Prevents memory accumulation over long sessions (wave 40+).
 * Oldest ammo is deleted when this limit is exceeded.
 */
const MAX_AMMO_ON_GROUND = 60; // REVERTED: User prefers 60 (relies on wave cleanup)
const AMMO_WAVE_CARRYOVER = 5; // Strict limit between waves (cleanup)

// ============================================================================
// EXPORTED STATS (Read by Zombie.ts)
// ============================================================================

/** Current zombie health (scales with wave) */
export let health = initHealth;

/** Current zombie speed (scales with wave) */
export let speed = initSpeed;



/** Probability (0-1) of spawning ammo on zombie death */
const ammoChance = 0.416;

/** Seconds to wait before unloading dead zombie (for death animation) */
const zombieRemovalDelay = 2.5;

// ============================================================================
// WAVE MANAGER COMPONENT
// ============================================================================

class WaveManager extends hz.Component<typeof WaveManager> {
  static propsDefinition = {
    /** Female zombie prefab asset */
    femaleZombie: { type: hz.PropTypes.Asset },
    /** Male zombie prefab asset */
    maleZombie: { type: hz.PropTypes.Asset },
    /** Skeleton zombie prefab asset (New Variant) */
    skeletonZombie: { type: hz.PropTypes.Asset },
    /** Lich/Boss zombie prefab asset (New Variant) */
    lichZombie: { type: hz.PropTypes.Asset },
    /** Henchman/Brute zombie prefab asset (New Variant) */
    henchmanZombie: { type: hz.PropTypes.Asset },
    
    /** Ammo pickup prefab asset */
    ammo: { type: hz.PropTypes.Asset },
    /** Reference to the HUD entity for UI updates */
    HUD: { type: hz.PropTypes.Entity },
    /** Sound effect played when a new wave starts */
    newWaveSFX: { type: hz.PropTypes.Entity },
  };

  // -------------------------------------------------------------------------
  // STATE
  // -------------------------------------------------------------------------

  /** Whether we're currently spawning zombies for this wave */
  private isSpawning = false;
  /** Timestamp when current wave started (for duration tracking) */
  private waveStartTime: number = 0;

  /** Ammo entities currently on the ground */
  private spawnedAmmo: hz.Entity[] = [];
  private processedZombieDeathSeq = new Map<string, number>();

  
  // -------------------------------------------------------------------------
  // OPTIMIZATION: THROTTLED ZOMBIE COUNT BROADCASTS
  // -------------------------------------------------------------------------
  
  /** Timestamp of last zombie count broadcast */
  private lastCountBroadcastTime = 0;
  /** Minimum interval between broadcasts (250ms) */
  private readonly countBroadcastInterval = 250;
  /** Flag indicating a broadcast is pending */
  private countBroadcastPending = false;
  /** Handle for the pending deferred broadcast timeout — stored so cleanup() can cancel it. */
  private countBroadcastTimer: number | null = null;

  /** Watchdog State for "Ghost Hunt" */
  private lastActiveCount = -1;
  private lastCountChangeTime = 0;
  private readonly WATCHDOG_TIMEOUT_MS = 420000; // 7 Minutes (less aggressive)
  private readonly WATCHDOG_REVEAL_MS = 180000;  // 3 Minutes before reveal
  private readonly WATCHDOG_MIN_WAVE = 4;        // Skip early waves
  private ghostHuntActive = false;
  private readonly WATCHDOG_MIN_ZOMBIES = 1;
  private readonly WATCHDOG_MAX_ZOMBIES = 3;

  /** Flag to prevent multiple win condition checks from stacking */
  private winConditionPending = false;
  /** Handle for the 1-second win-condition confirmation timer — stored so onWaveReset/Skip can cancel it. */
  private winConditionTimer: number | null = null;
  /** Handle for the 1-second delay before newWave() in reset/skip — stored to prevent double-fire. */
  private waveTransitionTimer: number | null = null;

  // Kept alive so Horizon's bundle cache stays warm — makes every ammo spawnAsset() call near-instant.
  private ammoPreloader: hz.SpawnController | null = null;

  private spawner!: SpawnManager;

  // -------------------------------------------------------------------------
  // UTILITY
  // -------------------------------------------------------------------------

  /**
   * Checks if this script instance is running on the server.
   * Spawning and state management should only happen on the server.
   */
  private isServer(): boolean {
    return this.world.getServerPlayer().id === this.entity.owner.get().id;
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE
  // -------------------------------------------------------------------------

  preStart(): void {
    // Connect to game loop events
    this.connectNetworkBroadcastEvent(Events.startGame, this.startGame.bind(this));
    this.connectNetworkBroadcastEvent(Events.zombieDeath, this.zombieDeath.bind(this));
    this.connectNetworkBroadcastEvent(Events.endGame, this.endGame.bind(this));
    this.connectNetworkBroadcastEvent(Events.requestStatus, this.onRequestStatus.bind(this));
    
    // NEW: Wave Control Events (from GameAdmin)
    this.connectNetworkBroadcastEvent(Events.requestWaveReset, this.onWaveReset.bind(this));
    this.connectNetworkBroadcastEvent(Events.requestWaveSkip, this.onWaveSkip.bind(this));
  }

  start(): void {
    if (!this.isServer()) return;
    
    // Initialize Spawn Manager
    this.spawner = new SpawnManager(this.world, this, this.async, this.props);
    
    // Subscribe to updates
    this.spawner.onUpdate = (active, total, waveTotal, remaining, dying, inFlight, pending, killed) => {
        this.scheduleCountUpdate(active, total, waveTotal, remaining, dying, inFlight, pending, killed);
    };

    // Clean up any leftover controllers then immediately start loading all zombie
    // bundles so they're cached before wave 1 starts (downloads during lobby time).
    this.spawner.clearControllers();
    this.spawner.preloadPool();

    // Preload the ammo asset so the bundle is cached — eliminates the spawn delay on first zombie drop.
    if (this.props.ammo) {
      this.ammoPreloader = new hz.SpawnController(this.props.ammo, hz.Vec3.zero, hz.Quaternion.one, hz.Vec3.one);
      this.ammoPreloader.load().catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // WAVE MANAGEMENT
  // -------------------------------------------------------------------------

  private onRequestStatus(): void {
    if (!this.isServer()) return;

    let active = 0;
    let inFlight = 0;
    let pending = 0;
    let remaining = 0;
    let dying = 0;
    let total = 0;

    if (this.spawner) {
      active = this.spawner.getActiveCount();
      inFlight = this.spawner.getInFlightCount();
      pending = this.spawner.getPendingCount();
      remaining = this.spawner.zombiesRemainingToSpawn;
      dying = this.spawner.getDyingCount();
      if (this.spawner.waveTotalZombies > 0) {
        total = this.spawner.waveTotalZombies;
      }
    }

    const visibleZombies = active + inFlight + pending;
    const unresolvedZombies = visibleZombies + remaining + dying;
    const safeTotal = Math.max(total, unresolvedZombies);
    const uptime = this.waveStartTime > 0 ? Math.floor((Date.now() - this.waveStartTime) / 1000) : 0;

    this.sendNetworkBroadcastEvent(Events.statusReport, {
      wave,
      zombies: visibleZombies,
      total: safeTotal,
      isSpawning: this.isSpawning,
      uptime,
    });
  }

  /**
   * Starts a new wave of zombies.
   * SERVER ONLY: Manages spawn pool and kicks off spawning.
   */
  newWave(): void {
    if (!this.isServer()) return;

    // ASSET VALIDATION: Ensure at least one zombie type is assigned
    const hasAnyZombieAsset = !!(
      this.props.maleZombie ||
      this.props.femaleZombie ||
      this.props.skeletonZombie ||
      this.props.lichZombie ||
      this.props.henchmanZombie
    );
    if (!hasAnyZombieAsset) {
        console.error("[WaveManager] FATAL ERROR: No zombie assets assigned! Spawning cannot start.");
        return;
    }
    
    this.waveStartTime = Date.now();
    this.sendLocalBroadcastEvent(Events.newWave, { wave });

    // CLEANUP: Broadcast force cleanup to all ammo boxes (purge invisible/collected)
    this.sendNetworkBroadcastEvent(Events.forceCleanupAmmo, { keepCount: AMMO_WAVE_CARRYOVER });

    // CLEANUP: Delete old ammo boxes from our tracking array
    this.cleanupOldAmmo();

    // Reset Watchdog / Ghost Hunt
    this.ghostHuntActive = false;
    this.sendNetworkBroadcastEvent(Events.ghostHunt, { enabled: false });
    this.lastActiveCount = -1;
    this.lastCountChangeTime = Date.now();

    // 1. START WAVE IN SPAWNER
    const totalZombies = wave * spawnIncrease;
    this.isSpawning = true;
    this.spawner.startWave(totalZombies, health, speed, wave);
  }

  /**
   * Disposes all spawn controllers and clears tracking sets.
   */
  clearControllers(): void {
     if (this.spawner) this.spawner.clearControllers();
  }

  /**
   * Cleans up old ammo boxes to prevent memory accumulation.
   * Called at the start of each wave to keep entity count low.
   * Deletes oldest ammo first if over the limit.
   */
  cleanupOldAmmo(): void {
    // 1. FILTER: Remove invalid references (ammo picked up by players)
    // This prevents the list from filling with dead entities
    this.spawnedAmmo = this.spawnedAmmo.filter(e => {
        try {
            return e.isValidReference.get();
        } catch {
            return false;
        }
    });

    // 2. TRIM: Delete oldest ammo until we hit the 'keep' limit
    const keepCount = AMMO_WAVE_CARRYOVER; // 5
    
    while (this.spawnedAmmo.length > keepCount) {
      const oldAmmo = this.spawnedAmmo.shift();
      if (oldAmmo) {
        try {
          if (oldAmmo.isValidReference.get()) {
             this.world.deleteAsset(oldAmmo, true);
          }
        } catch (e) { /* Ignore */ }
      }
    }
  }

  // -------------------------------------------------------------------------
  // POOL MANAGER (Event-Driven Spawning)
  // -------------------------------------------------------------------------



  // -------------------------------------------------------------------------
  // OPTIMIZATION: THROTTLED COUNT UPDATES
  // -------------------------------------------------------------------------

  /**
   * Schedules a zombie count broadcast.
   * OPTIMIZATION: Broadcasts are throttled to once per 500ms to reduce network traffic.
   * Multiple death events in quick succession are batched into a single broadcast.
   */
  scheduleCountUpdate(active?: number, total?: number, waveTotal?: number, remaining?: number, dying?: number, inFlight?: number, pending?: number, killed?: number): void {
      const now = Date.now();
      
      // If we recently broadcasted, mark as pending for later
      if (now - this.lastCountBroadcastTime < this.countBroadcastInterval) {
          if (!this.countBroadcastPending) {
              this.countBroadcastPending = true;
              // BUG FIX: Store handle so cleanup() can cancel before it fires on a dead component.
              this.countBroadcastTimer = this.async.setTimeout(() => {
                  this.countBroadcastTimer = null;
                  this.countBroadcastPending = false;
                  // Fetch fresh stats from spawner
                  this.updateZombieCount();
              }, this.countBroadcastInterval);
          }
          return;
      }
      
      // Broadcast immediately
      this.updateZombieCount(active, total, waveTotal, remaining, dying, inFlight, pending, killed);
  }

  /**
   * Broadcasts current zombie count to all clients.
   * Also checks for wave completion.
   */
  updateZombieCount(active?: number, total?: number, waveTotal?: number, remaining?: number, dying?: number, inFlight?: number, pending?: number, killed?: number): void {
      const now = Date.now();
      
      this.lastCountBroadcastTime = now;
      
      // Fetch from spawner if missing
      if (this.spawner) {
          if (active === undefined) active = this.spawner.getActiveCount();
          if (remaining === undefined) remaining = this.spawner.zombiesRemainingToSpawn;
          if (waveTotal === undefined || waveTotal === 0) waveTotal = this.spawner.waveTotalZombies;
          if (inFlight === undefined) inFlight = this.spawner.getInFlightCount();
          if (pending === undefined) pending = this.spawner.getPendingCount();
          if (dying === undefined) dying = this.spawner.getDyingCount();
      }
      
      // Fallback
      if (active === undefined) active = 0;
      if (remaining === undefined) remaining = 0;
      if (waveTotal === undefined) waveTotal = 0;
      if (inFlight === undefined) inFlight = 0;
      if (pending === undefined) pending = 0;
      if (dying === undefined) dying = 0;

      // Broadcast to HUD
      // count = currently active/alive zombies in world (cap pressure)
      // remaining = zombies not active yet (toSpawn + pending handoffs)
      // NOTE: `inFlight` overlaps with `pending`, so don't add both or it inflates totals.
      // NOTE: We keep `dying` out of HUD remaining so the right-side number drops
      // immediately on kill, but still include `dying` for win-condition safety.
      const unresolvedForDisplay = remaining + pending;
      const unresolvedForCompletion = unresolvedForDisplay + dying;
      const totalRemaining = active + unresolvedForCompletion;
      
      this.sendNetworkBroadcastEvent(Events.updateZombieCount, { 
          count: active,
          total: waveTotal,
          waveTotal: waveTotal,
          remaining: unresolvedForDisplay,
          loading: inFlight,
          pending,
          toSpawn: remaining
      });

      // --- WATCHDOG v2.0 (GHOST HUNT) ---
      // If 1-5 zombies remain, but count hasn't changed in 60s -> RESET
      const watchdogEligible =
          wave >= this.WATCHDOG_MIN_WAVE &&
          active >= this.WATCHDOG_MIN_ZOMBIES &&
          active <= this.WATCHDOG_MAX_ZOMBIES &&
          remaining === 0 &&
          inFlight === 0 &&
          pending === 0;

      if (watchdogEligible) {
          if (active !== this.lastActiveCount) {
              this.lastActiveCount = active;
              this.lastCountChangeTime = now;
          } else {
              const inactiveTime = now - this.lastCountChangeTime;
              
              // STAGE 1: Reveal (Proof of Life)
              if (inactiveTime > this.WATCHDOG_REVEAL_MS && !this.ghostHuntActive) {
                   console.log("[WaveManager] WATCHDOG: Potential stall detected. Revealing ghosts.");
                   this.ghostHuntActive = true;
                   this.sendNetworkBroadcastEvent(Events.ghostHunt, { enabled: true });
              }

              // STAGE 2: Reset
              if (inactiveTime > this.WATCHDOG_TIMEOUT_MS) {
                  console.log("[WaveManager] WATCHDOG: Wave stalled with " + active + " zombies. Resetting...");
                  
                  // Notify Players
                  this.sendNetworkBroadcastEvent(Events.playerDied, { name: "Wave reset due to zombie count" });
                  
                  // Reset Ghost Hunt
                  this.ghostHuntActive = false;
                  this.sendNetworkBroadcastEvent(Events.ghostHunt, { enabled: false });

                  // Reset State to prevent infinite loop
                  this.lastActiveCount = -1;
                  this.lastCountChangeTime = now;
                  
                  // Trigger Reset
                  this.onWaveReset();
                  return;
              }
          }
      } else {
          // Reset tracking if outside watchdog range
          if (this.ghostHuntActive) {
              this.ghostHuntActive = false;
              this.sendNetworkBroadcastEvent(Events.ghostHunt, { enabled: false });
          }
          this.lastActiveCount = -1;
      }

      // WIN CONDITION: All zombies dead and none remaining to spawn OR in flight/pending/dying
      // Guard against multiple timeouts stacking (prevents wave skipping)
      if (this.isSpawning && active === 0 && totalRemaining === 0 && waveTotal > 0 && !this.winConditionPending) {
          this.winConditionPending = true;
          // BUG FIX: Store timer handle so onWaveReset/Skip can cancel it before it fires.
          // Without this, a reset followed by a fast wave-complete could call newWave() twice.
          this.winConditionTimer = this.async.setTimeout(() => {
              this.winConditionTimer = null;
              // Fetch fresh to be absolutely sure
              const fActive = this.spawner.getActiveCount();
              const fInFlight = this.spawner.getInFlightCount();
              const fRemaining = this.spawner.zombiesRemainingToSpawn;
              const fPending = this.spawner.getPendingCount();
              const fDying = this.spawner.getDyingCount();

              if (this.isSpawning && fActive === 0 && fRemaining === 0 && fInFlight === 0 && fPending === 0 && fDying === 0) {
                  this.increaseZombieStats();
                  this.newWave();
              }
              // Reset flag after check completes (whether or not new wave started)
              this.winConditionPending = false;
          }, 1000);
      }
  }

  // -------------------------------------------------------------------------
  // DIFFICULTY SCALING
  // -------------------------------------------------------------------------

  /**
   * Increases zombie stats for the next wave.
   * Called when all zombies in current wave are killed.
   * Also saves wave progress to persistent storage so it's not lost on crash/kick.
   */
  increaseZombieStats(): void {
    const completedWave = wave;

    wave++;
    health = Math.min(health * healthIncrease, maxHealth); 
    speed = Math.min(speed * SpeedIncrease, maxSpeed);

    // Update HUD with new wave number
    if (this.props.HUD) {
      this.sendNetworkEvent(this.props.HUD, Events.viewWave, { wave });
    }
    
    // Play new wave sound effect
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const waveSFX = this.props.newWaveSFX?.as(hz.AudioGizmo);
    if (waveSFX) { waveSFX.stop(); waveSFX.play(); }

    // Track wave completion for stats
    if (this.waveStartTime > 0) {
        const duration = (Date.now() - this.waveStartTime) / 1000; 
        this.sendNetworkBroadcastEvent(Events.waveComplete, { wave: completedWave, duration }); 
    }
    
    // =========================================================================
    // WAVE HIGH SCORE PERSISTENCE
    // Saves highest wave reached for ALL alive players after each wave.
    // This ensures progress is saved even if players get kicked/disconnected.
    // =========================================================================
    this.saveWaveProgressForAllPlayers(completedWave);
  }
  
  /**
   * Saves wave progress to persistent storage and leaderboard for all alive players.
   * Only updates if current wave is higher than their stored high score.
   */
  private saveWaveProgressForAllPlayers(waveReached: number): void {
    if (!this.isServer()) return;
    
    const players = this.world.getPlayers();
    const serverId = this.world.getServerPlayer().id;
    
    for (const player of players) {
      if (player.id === serverId) continue;
      
      // Delegate to PersistenceManager (Handles both Storage and Leaderboards)
      PersistenceManager.saveWave(this.world, player, waveReached);
    }
  }

  // -------------------------------------------------------------------------
  // ZOMBIE DEATH HANDLING
  // -------------------------------------------------------------------------

  /**
   * Handles zombie death: spawns ammo, recycles controller.
   * 
   * @param data.zombie - The zombie entity that died
   */
  zombieDeath(data: { zombie: hz.Entity, killer?: hz.Player, seq?: number }): void {
    if (!this.isServer()) return;
    const deathKey = data.zombie?.id?.toString?.() ?? '';
    if (deathKey && data.seq !== undefined) {
      const lastSeq = this.processedZombieDeathSeq.get(deathKey) ?? 0;
      if (data.seq <= lastSeq) return;
      this.processedZombieDeathSeq.set(deathKey, data.seq);
    }
    const zombie = data.zombie;

    // If a zombie dies without a player killer (stuck/despawn/failsafe),
    // refund it back into the spawn pool so wave size remains consistent.
    if (!data.killer && this.isSpawning && this.spawner) {
      this.spawner.refundZombie();
    }

    // Chance to spawn ammo pickup
    // FIX: Unlimited drops during wave (Cleanup only happens at end of wave)
    if (Math.random() < ammoChance && this.props.ammo) {
      const pos = zombie.position.get().add(hz.Vec3.up);
      const rot = hz.Quaternion.fromEuler(new hz.Vec3(90, 0, 90));
      // Skip load() — spawn() handles loading internally and the preloader already warmed the
      // bundle cache, so this is a single async step instead of two sequential round-trips.
      // (Matching the pattern SpawnManager uses for zombies, which has no spawn delay.)
      const sc = new hz.SpawnController(this.props.ammo, pos, rot, hz.Vec3.one);
      sc.spawn()
        .then(() => {
          const entities = sc.rootEntities.get();
          if (!entities || entities.length === 0) {
            console.warn("[WaveManager] ammo spawn returned no entities.");
            return;
          }
          entities.forEach(e => {
            if (e) {
              // Toggle false→true forces a replication packet even if AmmoBox.start()
              // already set visible=true (same-value sets are deduped by Horizon).
              try { e.visible.set(false); e.visible.set(true); } catch {}
              this.spawnedAmmo.push(e);
            }
          });
        }).catch(e => {
          console.error("[WaveManager] Failed to spawn ammo pickup:", e);
        });
    }
    
    // Hand off to Spawner
    if (this.spawner) {
        this.spawner.handleZombieDeath(zombie);
    }
  }



  // -------------------------------------------------------------------------
  // GAME START/END
  // -------------------------------------------------------------------------

  /**
   * Starts the game: resets to wave 1 and begins spawning.
   */
  startGame(): void {
    if (!this.isServer()) return;

    wave = 1;
    health = initHealth;
    speed = initSpeed;
    this.winConditionPending = false; // Reset flag for fresh game
    this.newWave();
    
    // Update HUD with wave 1
    if (this.props.HUD) {
      this.sendNetworkEvent(this.props.HUD, Events.viewWave, { wave });
    }
    

  }

  /**
   * Ends the game: cleans up all zombies, ammo, and resets state.
   */
  endGame(): void {
    if (!this || !this.isServer()) return;
    
    // Reset stats to initial values
    health = initHealth;
    speed = initSpeed;
    this.isSpawning = false;
    this.winConditionPending = false; // Reset flag on game end
    this.clearControllers();
    
    // Cleanup all spawned ammo boxes
    this.spawnedAmmo.forEach(ammo => {
      try {
        this.world.deleteAsset(ammo, true);
      } catch (e) { /* Ignore if already deleted */ }
    });
    this.spawnedAmmo = [];
    
  }
  /**
   * Resets the current wave (e.g. if bugged).
   * Kills all zombies and restarts the wave logic.
   */
  private onWaveReset(): void {
    if (!this.isServer()) return;

    console.log("[WaveManager] Resetting Wave " + wave);

    // Stop current spawning
    this.isSpawning = false;

    // BUG FIX: Cancel any pending win-condition confirmation so it can't start a second wave
    // concurrently with the reset's newWave() call 1 second from now.
    if (this.winConditionTimer !== null) {
        this.async.clearTimeout(this.winConditionTimer);
        this.winConditionTimer = null;
    }
    this.winConditionPending = false;

    // Force kill connected zombies to clear the board
    this.spawner.forceKillAll();

    // BUG FIX: Store handle — rapid double-reset could queue two concurrent newWave() calls.
    if (this.waveTransitionTimer !== null) {
        this.async.clearTimeout(this.waveTransitionTimer);
    }
    this.waveTransitionTimer = this.async.setTimeout(() => {
        this.waveTransitionTimer = null;
        this.newWave();
    }, 1000);
  }

  /**
   * Skips to the next wave.
   * Kills all zombies and starts wave + 1.
   */
  private onWaveSkip(): void {
    if (!this.isServer()) return;

    console.log("[WaveManager] Skipping Wave " + wave);

    // Stop and Clear
    this.isSpawning = false;

    // BUG FIX: Cancel pending win-condition timer (same race as onWaveReset).
    if (this.winConditionTimer !== null) {
        this.async.clearTimeout(this.winConditionTimer);
        this.winConditionTimer = null;
    }
    this.winConditionPending = false;

    this.spawner.forceKillAll();

    // BUG FIX: Store handle — rapid double-skip could queue two concurrent newWave() calls.
    if (this.waveTransitionTimer !== null) {
        this.async.clearTimeout(this.waveTransitionTimer);
    }

    // Increment Wave
    wave++;
    health = Math.min(health * healthIncrease, maxHealth);
    speed = Math.min(speed * SpeedIncrease, maxSpeed);

    if (this.props.HUD) {
      this.sendNetworkEvent(this.props.HUD, Events.viewWave, { wave });
    }
    
    // Restart
    this.waveTransitionTimer = this.async.setTimeout(() => {
        this.waveTransitionTimer = null;
        this.newWave();
    }, 1000);
  }

  cleanup(): void {
    if (this.winConditionTimer !== null) {
      this.async.clearTimeout(this.winConditionTimer);
      this.winConditionTimer = null;
    }
    if (this.countBroadcastTimer !== null) {
      this.async.clearTimeout(this.countBroadcastTimer);
      this.countBroadcastTimer = null;
    }
    if (this.waveTransitionTimer !== null) {
      this.async.clearTimeout(this.waveTransitionTimer);
      this.waveTransitionTimer = null;
    }
    if (this.ammoPreloader !== null) {
      try { this.ammoPreloader.dispose(); } catch (e) { /* ignore */ }
      this.ammoPreloader = null;
    }
  }
}

hz.Component.register(WaveManager);
