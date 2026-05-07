import * as hz from 'horizon/core';
import { Events } from 'Events';
import { spawnLocations } from 'ZombieSpawnPoint';

/**
 * SPAWN MANAGER
 * Handles zombie pooling, spawning logic (LRU), and recycling.
 * Decoupled from WaveManager to reduce complexity.
 */

// POOL CONFIG
const MAX_CONCURRENT_ZOMBIES = 15;
const ZOMBIE_REMOVAL_DELAY = 4.0; // Seconds — allow death animation to finish before vanish
const SPAWN_STAGGER_MS = 75;       // Reduced from 150ms — cuts wave-start ramp-up time in half
const JANITOR_STUCK_MS = 150000;

export class SpawnManager {
  // CONFIG
  private world: hz.World;
  private component: hz.Component<any>;
  private async: any;
  private props: any; // Reference to WaveManager props (for assets)

  // STATE
  private controllers: hz.SpawnController[] = [];
  private controllerTimestamps: Map<hz.SpawnController, number> = new Map();
  private reservedControllers = new Set<hz.SpawnController>();
  private zombieToController = new Map<bigint, hz.SpawnController>();
  private dyingZombies = new Set<hz.Entity>();
  // BUG FIX: Track dying zombies by ID (bigint) instead of object reference.
  // hz.Entity wrappers from different call sites (rootEntities.get() vs Events.zombieDeath data)
  // are different JS objects for the same entity, so Set.has() by reference always returns false.
  // Using IDs ensures dying zombies are properly excluded from getActiveCount().
  private dyingZombieIds = new Set<bigint>();
  
  // WAVE STATE
  public zombiesRemainingToSpawn = 0;
  public waveTotalZombies = 0;
  private currentHealth = 100;
  private currentSpeed = 1.0;
  private currentWave = 1;
  private isClearing = false;
  private pendingSpawnCount = 0;
  private killedZombiesCount = 0;
  // BUG FIX: Generation counter — incremented on every clearControllers()/startWave() so that
  // delayed death-cleanup timers from the previous wave silently discard themselves instead of
  // calling unload() on already-disposed SpawnControllers.
  private waveGeneration = 0;
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — use number, not any.
  private spawnRetryTimer: number | null = null;

  constructor(world: hz.World, component: hz.Component<any>, async: any, props: any) {
    this.world = world;
    this.component = component;
    this.async = async;
    this.props = props;
  }

  /**
   * Initializes the zombie pool for a new wave.
   */
  public startWave(totalZombies: number, health: number, speed: number, waveNum: number): void {
     this.currentHealth = health;
     this.currentSpeed = speed;
     this.currentWave = waveNum;
     
      this.zombiesRemainingToSpawn = totalZombies;
      this.waveTotalZombies = totalZombies;
      this.pendingSpawnCount = 0;
      this.killedZombiesCount = 0;
      this.zombieToController.clear();
      this.reservedControllers.clear();
      this.clearSpawnRetry();
     
     const targetPoolSize = Math.min(totalZombies, MAX_CONCURRENT_ZOMBIES);

     // Keep controllers that are already Loaded or Loading — their bundles are cached/in-progress.
     // Disposing a Loading controller cancels the download so the cache never populates, which
     // was the root cause of the infinite spawn-timeout loop on first visit.
     this.controllers = this.controllers.filter(sc => {
         const state = sc.currentState.get();
         if (state === hz.SpawnState.Loaded || state === hz.SpawnState.Loading) return true;
         // Unload before disposing so the entity is properly despawned.
         // dispose() alone on an Active controller orphans the entity — body stays in the world.
         if (state === hz.SpawnState.Active || state === hz.SpawnState.Unloading) {
             try { sc.unload(); } catch {}
         }
         try { sc.dispose(); } catch {}
         return false;
     });
     this.controllerTimestamps.clear();

     // Fill remaining slots with fresh Unloaded controllers.
     // spawnNextBatch() handles load() with a 90s timeout — pre-loading here has
     // no timeout and hangs permanently if Horizon is syncing a mid-wave player join.
     while (this.controllers.length < targetPoolSize) {
         const sc = this.createFreshController();
         if (!sc) break;
         this.controllers.push(sc);
     }

    // Kickstart
    this.spawnNextBatch();
    this.startWatchdog(); 
  }

  /**
   * Called when a zombie dies by accident (stuck/suicide).
   * Adds +1 to the spawn pool so it gets replaced.
   */
  public refundZombie(): void {
      this.zombiesRemainingToSpawn++;
      // We don't call spawnNextBatch immediately here; 
      // handleZombieDeath will call checkAndRecycle -> spawnNextBatch
  }

  public clearControllers(): void {
      // Advance generation so any in-flight death timers discard themselves.
      this.waveGeneration++;
      this.stopWatchdog();
      this.clearSpawnRetry();
      if (this.controllers) {
           this.controllers.forEach(sc => sc.dispose());
      }
      this.controllers = [];
      this.dyingZombies.clear();
      this.dyingZombieIds.clear();
      this.reservedControllers.clear();
      this.zombieToController.clear();
      this.controllerTimestamps.clear();
      this.pendingSpawnCount = 0;
  }

  /**
   * Forces all zombies to unload immediately.
   * Used for Game Reset / Wave Skip.
   */
  public forceKillAll(): void {
      this.isClearing = true;
      this.clearSpawnRetry();
      if (this.controllers) {
          this.controllers.forEach(sc => {
              // Only unload active ones
              const s = sc.currentState.get();
              if (s === hz.SpawnState.Active || s === hz.SpawnState.Loading) {
                  sc.unload();
              }
          });
      }
      // Reset counters immediately
      this.dyingZombies.clear();
      this.dyingZombieIds.clear();
      this.zombiesRemainingToSpawn = 0;
      this.pendingSpawnCount = 0;
      this.killedZombiesCount = 0;
      this.reservedControllers.clear();
      this.zombieToController.clear();
      this.controllerTimestamps.clear();
      this.isClearing = false;
      this.notifyUpdate();
  }

  private clearSpawnRetry(): void {
      if (this.spawnRetryTimer) {
          this.async.clearTimeout(this.spawnRetryTimer);
          this.spawnRetryTimer = null;
      }
  }

  private scheduleSpawnRetry(delayMs: number = 1000): void {
      if (this.spawnRetryTimer || this.isClearing) return;
      this.spawnRetryTimer = this.async.setTimeout(() => {
          this.spawnRetryTimer = null;
          this.spawnNextBatch();
      }, delayMs);
  }

  private getValidSpawnLocations(): hz.Entity[] {
      return spawnLocations.filter((location) => {
          try {
              return !!location && location.isValidReference.get();
          } catch {
              return false;
          }
      });
  }

  private pickSpawnLocation(candidates: hz.Entity[]): hz.Entity {
      return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private canScheduleController(sc: hz.SpawnController): boolean {
      if (this.reservedControllers.has(sc)) return false;
      const state = sc.currentState.get();
      if (state === hz.SpawnState.Unloaded) return true;
      if (state !== hz.SpawnState.Loaded) return false;

      const roots = sc.rootEntities.get();
      return !roots || roots.length === 0;
  }

  /**
   * Pre-loads all idle controllers so they're in Loaded state when the next wave's spawn() fires.
   * Called during the win-condition confirmation window (1s between wave end and wave start),
   * hiding load latency inside the gap the player already waits through.
   */
  public preloadForNextWave(): void {
      this.controllers.forEach(sc => {
          try {
              if (sc.currentState.get() === hz.SpawnState.Unloaded) {
                  sc.load().catch(() => {});
              }
          } catch {}
      });
  }

  /**
   * Creates the full zombie pool and begins loading all controllers.
   * Call once at game-server start so wave-1 spawn() skips the load step entirely.
   */
  public preloadPool(targetSize: number = MAX_CONCURRENT_ZOMBIES): void {
      const variants: hz.Asset[] = [];
      if (this.props.maleZombie) variants.push(this.props.maleZombie);
      if (this.props.femaleZombie) variants.push(this.props.femaleZombie);
      if (this.props.skeletonZombie) variants.push(this.props.skeletonZombie);
      if (this.props.lichZombie) variants.push(this.props.lichZombie);
      if (this.props.henchmanZombie) variants.push(this.props.henchmanZombie);
      if (this.props.samuraiZombie) variants.push(this.props.samuraiZombie);
      if (variants.length === 0) return;

      // Load one controller per variant first — guarantees all bundles get cached.
      for (const prefab of variants) {
          if (this.controllers.length >= targetSize) break;
          const sc = new hz.SpawnController(prefab, new hz.Vec3(0, -1500, 0), hz.Quaternion.one, hz.Vec3.one);
          this.controllers.push(sc);
      }
      // Fill remaining slots with random variants.
      while (this.controllers.length < targetSize) {
          const prefab = variants[Math.floor(Math.random() * variants.length)];
          const sc = new hz.SpawnController(prefab, new hz.Vec3(0, -1500, 0), hz.Quaternion.one, hz.Vec3.one);
          this.controllers.push(sc);
      }
      this.preloadForNextWave();
  }

  /**
   * Main Spawn Loop
   */
  public spawnNextBatch(): void {
      if (this.isClearing || this.zombiesRemainingToSpawn <= 0) return;

      const validSpawnLocations = this.getValidSpawnLocations();
      if (validSpawnLocations.length === 0) {
          this.scheduleSpawnRetry(1000);
          return;
      }

      const availableWorkers = this.controllers.filter(sc => {
          return this.canScheduleController(sc);
      });

      if (availableWorkers.length === 0 && this.zombiesRemainingToSpawn > 0) {
          // Silent console log to avoid flooding during normal recycling
          // console.log(`[SpawnManager] No available workers for ${this.zombiesRemainingToSpawn} zombies. Waiting for recycling...`);
          this.scheduleSpawnRetry(250);
          return;
      }

		// All zombies load in parallel — no concurrency limit.
		// load() is called explicitly so L shows in debug (confirms loading is happening).
		// spawn() on an already-Loaded controller is near-instant (no re-download).
		availableWorkers.forEach((sc, index) => {
			this.reservedControllers.add(sc);
			if (this.isClearing || this.zombiesRemainingToSpawn <= 0) return;

			this.async.setTimeout(() => {
				if (this.isClearing || this.zombiesRemainingToSpawn <= 0) {
					this.reservedControllers.delete(sc);
					return;
				}

				this.zombiesRemainingToSpawn--;
				this.pendingSpawnCount++;
				this.controllerTimestamps.set(sc, Date.now());
				this.notifyUpdate();

				// 90s timeout — bundles can take 30-60s to download on first visit.
				// Aborting too early caused infinite retry loops (the download never cached).
				let spawnSettled = false;
				const timeoutId = this.async.setTimeout(() => {
                    if (spawnSettled) return;
                    spawnSettled = true;
                    console.warn("[SpawnManager] Spawn timed out (90s) — replacing controller and retrying.");
                    if (this.pendingSpawnCount > 0) this.pendingSpawnCount--;
                    this.zombiesRemainingToSpawn++;
                    this.controllerTimestamps.delete(sc);
                    this.reservedControllers.delete(sc);
                    const idx = this.controllers.indexOf(sc);
                    try { sc.dispose(); } catch {}
                    if (idx > -1) {
                        const fresh = this.createFreshController();
                        if (fresh) this.controllers[idx] = fresh;
                        else this.controllers.splice(idx, 1);
                    }
                    this.notifyUpdate();
                    this.scheduleSpawnRetry(1000);
                }, 90000);

				// Skip load() if already Loaded (preloaded during lobby) — spawn() is near-instant.
				// Otherwise call load() first; may take 30-60s on first Quest visit.
				const alreadyLoaded = sc.currentState.get() === hz.SpawnState.Loaded;
				(alreadyLoaded ? Promise.resolve() : sc.load())
					.then(() => {
						if (spawnSettled) return Promise.reject('settled');
						return sc.spawn();
					})
					.then(() => {
						if (spawnSettled) return;
						spawnSettled = true;
						this.async.clearTimeout(timeoutId);

						const candidates = this.getValidSpawnLocations();
						if (candidates.length === 0) {
							console.warn("[SpawnManager] No spawn points — refunding zombie.");
							if (this.pendingSpawnCount > 0) this.pendingSpawnCount--;
							this.controllerTimestamps.delete(sc);
							this.reservedControllers.delete(sc);
							this.zombiesRemainingToSpawn++;
							this.notifyUpdate();
							this.scheduleSpawnRetry(500);
							return;
						}

						const location = this.pickSpawnLocation(candidates);
						const roots = sc.rootEntities.get();
						if (roots && roots.length > 0) {
							const zombie = roots[0];
							this.zombieToController.set(zombie.id, sc);
							this.component.sendLocalEvent(location, Events.queueZombie, {
								zombie,
								health: this.currentHealth,
								speed: this.currentSpeed,
								wave: this.currentWave
							});
						} else {
							console.warn("[SpawnManager] Spawned zombie has no root entity — refunding.");
							if (this.pendingSpawnCount > 0) this.pendingSpawnCount--;
							this.controllerTimestamps.delete(sc);
							this.reservedControllers.delete(sc);
							this.zombiesRemainingToSpawn++;
							this.notifyUpdate();
							this.scheduleSpawnRetry(500);
							return;
						}

						this.pendingSpawnCount--;
						this.controllerTimestamps.delete(sc);
						this.reservedControllers.delete(sc);
						this.notifyUpdate();
						this.spawnNextBatch();
					})
					.catch(e => {
						if (spawnSettled || e === 'settled') return;
						spawnSettled = true;
						this.async.clearTimeout(timeoutId);
						console.error("[SpawnManager] Spawn Error: " + e);
						if (this.pendingSpawnCount > 0) this.pendingSpawnCount--;
						this.controllerTimestamps.delete(sc);
						this.reservedControllers.delete(sc);
						this.zombiesRemainingToSpawn++;
						// Dispose and replace — error may indicate a bad controller.
						const idx = this.controllers.indexOf(sc);
						try { sc.dispose(); } catch {}
						if (idx > -1) {
							const fresh = this.createFreshController();
							if (fresh) this.controllers[idx] = fresh;
							else this.controllers.splice(idx, 1);
						}
						this.notifyUpdate();
						this.scheduleSpawnRetry(1000);
					});
			}, index * SPAWN_STAGGER_MS);
		});
	}

  // ============================================================================
  // SAFETY WATCHDOG
  // ============================================================================
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — use number, not any.
  private watchdogTimer: number | null = null;

  public startWatchdog(): void {
      if (this.watchdogTimer) this.async.clearInterval(this.watchdogTimer);
      
      console.log("[SpawnManager] Watchdog Started");
      this.watchdogTimer = this.async.setInterval(() => {
          const active = this.getActiveCount();
          const inFlight = this.getInFlightCount();
          const remaining = this.zombiesRemainingToSpawn;
          const pending = this.pendingSpawnCount;
          
          // VERIFY TOTAL INTEGRITY (RECOVERY MODE)
          // If the sum is lower than waveTotal, some zombies were "lost" (crashed/no refund)
          const dying = this.dyingZombies.size;
          const currentTotal = active + inFlight + remaining + pending + dying + this.killedZombiesCount;
          if (currentTotal < this.waveTotalZombies && !this.isClearing) {
              console.warn(`[SpawnManager] RECOVERY: Missing ${this.waveTotalZombies - currentTotal} zombies. Adjusting remaining pool.`);
              this.zombiesRemainingToSpawn += (this.waveTotalZombies - currentTotal);
              this.spawnNextBatch();
              return;
          }

          // RECOVERY: If spawning is idle but zombies remain, retry spawning.
          if (!this.isClearing && remaining > 0 && inFlight === 0 && pending === 0) {
              this.spawnNextBatch();
          }

          // 3. CONCURRENCY JANITOR (Leak Prevention)
          const now = Date.now();
          this.controllers.forEach(sc => {
              const state = sc.currentState.get();
              const startTime = this.controllerTimestamps.get(sc);

              // JANITOR: If stuck in Loading for too long or Active without entity
              if (startTime && (now - startTime > JANITOR_STUCK_MS)) {
                  const roots = sc.rootEntities.get();
                  const noRoots = !roots || roots.length === 0;

                  if (state === hz.SpawnState.Loading || (state === hz.SpawnState.Active && noRoots)) {
                      console.warn(`[SpawnManager] JANITOR: Reclaiming stuck controller (State: ${state}, NoRoots: ${noRoots})`);
                      if (roots && roots.length > 0) {
                          this.zombieToController.delete(roots[0].id);
                      }
                      sc.unload();
                      // Clear state to let them be picked up in next rotation
                      this.controllerTimestamps.delete(sc);
                      this.reservedControllers.delete(sc);

                      // Safety: Check if we need to decrement pending if it was stuck in loading
                      if (state === hz.SpawnState.Loading && this.pendingSpawnCount > 0) {
                          this.pendingSpawnCount--;
                      }

                      this.rebalanceAfterForcedRecycle();
                  }
              }
          });

          // HEARTBEAT: Always ping WaveManager so the win condition can re-check.
          // Without this, if the one-shot notifyUpdate() from the last zombie's
          // cleanup timer is missed (throttle race), the win condition never retries.
          this.notifyUpdate();
      }, 5000); // Check every 5 seconds
  }

  public stopWatchdog(): void {
      if (this.watchdogTimer) {
          this.async.clearInterval(this.watchdogTimer);
          this.watchdogTimer = null;
      }
  }

  public handleZombieDeath(zombie: hz.Entity): void {
      let sc = this.zombieToController.get(zombie.id);
      if (!sc) {
          sc = this.controllers.find(c => {
              const roots = c.rootEntities.get();
              return roots && roots.length > 0 && roots[0].id === zombie.id;
          });
      }

      if (sc) {
        const controller = sc;
        this.zombieToController.delete(zombie.id);
        this.dyingZombies.add(zombie);
        // BUG FIX: Track by ID — entity wrappers from rootEntities.get() vs event data are
        // different JS objects, so Set.has() by reference returns false. ID comparison is reliable.
        try { this.dyingZombieIds.add(zombie.id); } catch {}

        this.notifyUpdate();

        // BUG FIX: Capture current generation so these timers self-discard after a
        // clearControllers() call. Without this, they call unload() on disposed controllers.
        const gen = this.waveGeneration;
        this.async.setTimeout(() => {
            if (this.waveGeneration !== gen) {
                // Wave was reset — clearControllers() already wiped dyingZombies, nothing to do.
                return;
            }
            // Hide just before unload so the death animation plays for the full delay window.
            try { if (zombie.isValidReference.get()) zombie.visible.set(false); } catch {}
            controller.unload();
            // BUG FIX: Do NOT clear dyingZombieIds here. Hand zombie to checkAndRecycle so it
            // clears the dying state only AFTER confirming the controller has exited Active/Unloading.
            // Clearing here (fixed 1s timer) races with the unload — if the controller is still
            // Unloading when dyingCount hits 0, the win condition fires and startWave() disposes
            // the Unloading controller without properly despawning the entity, leaving bodies on
            // the ground and the active count stuck > 0.
            this.async.setTimeout(() => {
                if (this.waveGeneration !== gen) {
                    this.dyingZombies.delete(zombie);
                    try { this.dyingZombieIds.delete(zombie.id); } catch {}
                    return;
                }
                this.checkAndRecycle(controller, zombie, gen);
            }, 500);
        }, ZOMBIE_REMOVAL_DELAY * 1000);
      } else {
        // BUG FIX: Guard against spurious refunds during forceKillAll() — isClearing is set
        // during reset, so any zombie deaths that arrive (via broadcast) while clearing should
        // be silently dropped rather than inflating zombiesRemainingToSpawn.
        if (!this.isClearing) {
            console.warn("[SpawnManager] Zombie death received with no controller match; issuing replacement.");
            this.zombiesRemainingToSpawn++;
            this.rebalanceAfterForcedRecycle();
        }
      }
  }

  // BUG FIX: zombie + gen parameters let us bail safely and own the dying-state cleanup.
  // attempt caps at 100 (10s at 100ms each) to handle controllers stuck in Active/Unloading.
  private checkAndRecycle(sc: hz.SpawnController, zombie: hz.Entity, gen: number, attempt: number = 0): void {
      if (this.waveGeneration !== gen) {
          // Wave was reset mid-recycle — clearControllers() wiped dyingZombies already.
          // Still clear these defensively in case the reset happened between the two clears.
          this.dyingZombies.delete(zombie);
          try { this.dyingZombieIds.delete(zombie.id); } catch {}
          return;
      }
      const state = sc.currentState.get();
      const roots = (() => { try { return sc.rootEntities.get(); } catch { return null; } })();
      const hasRoots = !!roots && roots.length > 0;
      // Also wait when Loaded+roots: Horizon can keep the entity alive in Loaded state.
      // Disposing a Loaded+roots controller skips the entity despawn — body stays in world.
      const stillBusy =
          state === hz.SpawnState.Active ||
          state === hz.SpawnState.Loading ||
          state === hz.SpawnState.Unloading ||
          (state === hz.SpawnState.Loaded && hasRoots);
      if (stillBusy) {
          if (attempt < 100) {
              this.async.setTimeout(() => this.checkAndRecycle(sc, zombie, gen, attempt + 1), 100);
              return;
          }
          // 10s timeout: force one more unload attempt, then dispose regardless.
          console.warn(`[SpawnManager] checkAndRecycle: controller stuck (state=${state} roots=${hasRoots}) after 10s — force-unloading.`);
          try { sc.unload(); } catch {}
      }

      // Entity is despawned (or we forced past the stuck timeout).
      // NOW it is safe to clear the dying state — getDyingCount() will drop,
      // letting the win condition fire only after the entity is truly gone.
      this.dyingZombies.delete(zombie);
      try { this.dyingZombieIds.delete(zombie.id); } catch {}
      this.killedZombiesCount++;
      this.notifyUpdate();

      // Dispose recycled controller and replace with a fresh one.
      // Reused controllers silently hang on spawn() — always create fresh.
      this.reservedControllers.delete(sc);
      const idx = this.controllers.indexOf(sc);
      try { sc.dispose(); } catch {}
      if (idx > -1) {
          const fresh = this.createFreshController();
          if (fresh) this.controllers[idx] = fresh;
          else this.controllers.splice(idx, 1);
      }
      this.spawnNextBatch();
  }

  private createFreshController(): hz.SpawnController | null {
      const variants: hz.Asset[] = [];
      if (this.props.maleZombie) variants.push(this.props.maleZombie);
      if (this.props.femaleZombie) variants.push(this.props.femaleZombie);
      if (this.props.skeletonZombie) variants.push(this.props.skeletonZombie);
      if (this.props.lichZombie) variants.push(this.props.lichZombie);
      if (this.props.henchmanZombie) variants.push(this.props.henchmanZombie);
      if (this.props.samuraiZombie) variants.push(this.props.samuraiZombie);
      if (variants.length === 0) return null;
      const prefab = variants[Math.floor(Math.random() * variants.length)];
      return new hz.SpawnController(prefab, new hz.Vec3(0, -1500, 0), hz.Quaternion.one, hz.Vec3.one);
  }

  private notifyUpdate() {
      if (this.isClearing) return;
      // Callback to WaveManager to update UI / Check Win Condition
      // We can iterate active controllers here to get the count
      const activeCount = this.getActiveCount();
      const inFlightCount = this.getInFlightCount();
      // We actually need to communicate this back. 
      // Option A: Callback function passed in constructor.
      // Option B: Event.
      // Let's use a callback set by WaveManager.
      if (this.onUpdate) this.onUpdate(activeCount, this.controllers.length, this.waveTotalZombies, this.zombiesRemainingToSpawn, this.dyingZombies.size, inFlightCount, this.pendingSpawnCount, this.killedZombiesCount);
  }
  
  public onUpdate: ((active: number, total: number, waveTotal: number, remaining: number, dying: number, inFlight: number, pending: number, killed: number) => void) | null = null;

  public getActiveCount(): number {
      return this.controllers.filter(sc => {
          const state = sc.currentState.get();

          // IMPORTANT: In Horizon, spawned entities can remain in Loaded state
          // while still being alive/usable, so count both Loaded + Active (+Paused).
          const liveState =
              state === hz.SpawnState.Active ||
              state === hz.SpawnState.Loaded ||
              state === hz.SpawnState.Paused;
          if (!liveState) return false;

          const roots = sc.rootEntities.get();
          if (!roots || roots.length === 0) return false;
          // BUG FIX: Use ID-based comparison — reference equality fails across call sites.
          try { if (this.dyingZombieIds.has(roots[0].id)) return false; } catch {}
          return true;
      }).length;
  }

  public getInFlightCount(): number {
      return this.controllers.filter(sc => {
          const state = sc.currentState.get();
          // ONLY trust the named enum for Loading state. 
          // Avoid magic numbers that vary by Horizon runtime.
          return state === hz.SpawnState.Loading;
      }).length;
  }

  public getPendingCount(): number {
      return this.pendingSpawnCount;
  }

  public getDyingCount(): number {
      return this.dyingZombies.size;
  }

  public getKilledCount(): number {
      return this.killedZombiesCount;
  }

  private rebalanceAfterForcedRecycle(): void {
      const accounted =
          this.getActiveCount() +
          this.getInFlightCount() +
          this.pendingSpawnCount +
          this.zombiesRemainingToSpawn +
          this.dyingZombies.size +
          this.killedZombiesCount;

      if (accounted < this.waveTotalZombies) {
          this.zombiesRemainingToSpawn += (this.waveTotalZombies - accounted);
      } else if (accounted > this.waveTotalZombies) {
          const overflow = accounted - this.waveTotalZombies;
          this.zombiesRemainingToSpawn = Math.max(0, this.zombiesRemainingToSpawn - overflow);
      }

      this.notifyUpdate();
      this.spawnNextBatch();
  }
}
