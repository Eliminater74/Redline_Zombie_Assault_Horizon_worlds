import * as hz from 'horizon/core';
import { Events } from 'Events';

/**
 * WEAPON MANAGER (SpawnController Pattern)
 * 
 * Dynamically spawns weapons for each player who joins.
 * Uses the same spawning pattern that works for zombies.
 * 
 * OPTIMIZATIONS:
 * - Parallel spawning for multiple players
 * - Faster watchdog (2 seconds instead of 5)
 * - Immediate retry on spawn failure
 * - Better cleanup on player leave
 */
class WeaponManager extends hz.Component<typeof WeaponManager> {
  static propsDefinition = {
    weaponBundle: { type: hz.PropTypes.Asset },
  };

  // Track spawn controllers per player
  private playerControllers = new Map<number, hz.SpawnController>();
  
  // Players currently in spawn process (prevents duplicate spawns)
  private spawningPlayers = new Set<number>();
  
  // Track spawn attempts for retry limiting
  private spawnAttempts = new Map<number, number>();
  
  // Maximum spawn attempts before giving up
  private readonly MAX_SPAWN_ATTEMPTS = 3;
  
  // PRELOAD: Cached for faster subsequent spawns
  private bundleLoaded = false;
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store handle to cancel in cleanup().
  private watchdogInterval: number | null = null;

  /**
   * Checks if this script is running on the server.
   */
  private isServer(): boolean {
    return this.entity.owner.get().id === this.world.getServerPlayer().id;
  }

  preStart(): void {
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterWorld,
      this.onPlayerJoin.bind(this)
    );

    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerExitWorld,
      this.onPlayerLeave.bind(this)
    );
  }

  start(): void {
    if (!this.isServer()) return;
    
    // Start watchdog for weapon recovery
    this.startWatchdog(); 
    
    // PRELOAD: Cache the weapon bundle for faster spawning
    if (this.props.weaponBundle) {
      const preloader = new hz.SpawnController(
        this.props.weaponBundle,
        hz.Vec3.zero,
        hz.Quaternion.one,
        hz.Vec3.one
      );
      
      preloader.load().then(() => {
        this.bundleLoaded = true;
        // Spawn for existing players after preload
        this.spawnForExistingPlayers();
      }).catch((e) => {
        console.error(`[WeaponManager] Preload failed: ${e}, spawning directly...`);
        this.spawnForExistingPlayers();
      });
    } else {
      this.spawnForExistingPlayers();
    }
  }
  
  private spawnForExistingPlayers(): void {
    const players = this.world.getPlayers();
    const serverId = this.world.getServerPlayer().id;
    
    for (const player of players) {
      if (player.id !== serverId) {
        if (!this.playerControllers.has(player.id) && !this.spawningPlayers.has(player.id)) {
          this.spawnWeaponsForPlayer(player);
        }
      }
    }
  }

  /**
   * Called when a player joins the world.
   * Spawns weapons immediately without delay.
   */
  private onPlayerJoin(player: hz.Player): void {
    if (!this.isServer()) return;
    if (player.id === this.world.getServerPlayer().id) return;

    // Skip if already has weapons or is spawning
    if (this.playerControllers.has(player.id) || this.spawningPlayers.has(player.id)) {
      return;
    }
    
    // Reset spawn attempts for this player
    this.spawnAttempts.set(player.id, 0);
    
    // OPTIMIZATION: No delay - spawn immediately
    this.spawnWeaponsForPlayer(player);
  }

  /**
   * Called when a player leaves the world.
   * Cleans up their weapons immediately.
   */
  private onPlayerLeave(player: hz.Player): void {
    if (!this.isServer()) return;
    
    this.spawningPlayers.delete(player.id);
    this.spawnAttempts.delete(player.id);
    this.despawnWeaponsForPlayer(player.id);
  }

  /**
   * Spawns a weapon bundle for the specified player.
   * OPTIMIZED: Faster attachment, better error handling.
   */
  private spawnWeaponsForPlayer(player: hz.Player): void {
    if (!this.props.weaponBundle) {
      // Silent fail - prop may not be loaded on all instances
      return;
    }
    
    // Safety: Track that we're spawning for this player
    this.spawningPlayers.add(player.id);
    
    // Track attempt count
    const attempts = (this.spawnAttempts.get(player.id) || 0) + 1;
    this.spawnAttempts.set(player.id, attempts);
    
    if (attempts > this.MAX_SPAWN_ATTEMPTS) {
      console.error(`[WeaponManager] Max spawn attempts reached for ${player.name.get()}`);
      this.spawningPlayers.delete(player.id);
      return;
    }

    const spawnPos = player.position.get().add(new hz.Vec3(0, 0.5, 0.5));
    
    const sc = new hz.SpawnController(
      this.props.weaponBundle,
      spawnPos,
      hz.Quaternion.one,
      hz.Vec3.one
    );

    // Store controller immediately so watchdog doesn't trigger
    this.playerControllers.set(player.id, sc);

    sc.load()
      .then(() => sc.spawn())
      .then(() => {
        // Safety: Check if player still exists
        if (!player.isValidReference.get()) {
          sc.unload();
          this.playerControllers.delete(player.id);
          this.spawningPlayers.delete(player.id);
          return;
        }

        const rootEntities = sc.rootEntities.get();
        
        if (!rootEntities || rootEntities.length === 0) {
          console.error(`[WeaponManager] No root entities spawned for ${player.name.get()}`);
          this.spawningPlayers.delete(player.id);
          return;
        }
        
        // ATTACH WEAPONS INSTANTLY
        for (const root of rootEntities) {
          const children = root.children.get();
          
          for (const child of children) {
            try {
              const childName = child.name.get().toLowerCase();
              
              // Skip effect entities - they stay with their parent weapon
              if (childName.includes('bullet') || childName.includes('spark') || childName.includes('line')) {
                child.owner.set(player);
                continue;
              }
              
              child.owner.set(player);
              child.visible.set(true);

              // NEW: Explicitly initialize the weapon (Fixes Race Condition)
              this.sendNetworkEvent(child, Events.initializeWeapon, { player });
              
              try {
                const grabbable = child.as(hz.GrabbableEntity);
                if (grabbable) {
                  grabbable.setWhoCanGrab([player]);
                  
                  const attachable = child.as(hz.AttachableEntity);
                  if (attachable) {
                    attachable.attachToPlayer(player, hz.AttachablePlayerAnchor.Torso);
                  }
                }
              } catch (e) {
                // Not grabbable/attachable, that's fine
              }
            } catch (e) {
              console.error(`[WeaponManager] Error attaching child: ${e}`);
            }
          }
          
          root.owner.set(player);
        }
        
        // Success! Clear spawning flag
        this.spawningPlayers.delete(player.id);
      })
      .catch((e) => {
        console.error(`[WeaponManager] Spawn failed for ${player.name.get()}: ${e}`);
        this.spawningPlayers.delete(player.id);
        this.playerControllers.delete(player.id);
        
        // RETRY: Schedule a retry if under max attempts
        const currentAttempts = this.spawnAttempts.get(player.id) || 0;
        if (currentAttempts < this.MAX_SPAWN_ATTEMPTS && player.isValidReference.get()) {
          this.async.setTimeout(() => {
            this.spawnWeaponsForPlayer(player);
          }, 500); // 500ms retry delay
        }
      });
  }

  /**
   * Despawns and cleans up weapons for a player.
   */
  private despawnWeaponsForPlayer(playerId: number): void {
    const sc = this.playerControllers.get(playerId);
    if (sc) {
      try {
        sc.unload();
        sc.dispose();
      } catch (e) {
        console.error(`[WeaponManager] Error disposing weapons: ${e}`);
      }
      this.playerControllers.delete(playerId);
    }
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.watchdogInterval !== null) {
      this.async.clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * WATCHDOG: Periodically checks for players missing weapons.
   * Runs only on server. Detects both never-spawned and lost weapons.
   */
  private startWatchdog(): void {
    this.watchdogInterval = this.async.setInterval(() => {
      // CRITICAL: Only run watchdog on server where prop is available
      if (!this.isServer()) return;
      if (!this.props.weaponBundle) return; // No bundle = can't spawn
      
      const players = this.world.getPlayers();
      const serverId = this.world.getServerPlayer().id;

      for (const player of players) {
        if (player.id === serverId) continue;
        
        // Skip if currently being spawned/processed
        if (this.spawningPlayers.has(player.id)) continue;

        let needsRespawn = false;
        
        // Case 1: Never got a controller
        if (!this.playerControllers.has(player.id)) {
          needsRespawn = true;
        } else {
          // Case 2: Has controller but check if it's still valid
          const sc = this.playerControllers.get(player.id);
          if (sc) {
            try {
              const state = sc.currentState.get();
              // If controller is no longer active, weapons are lost
              if (state !== hz.SpawnState.Active) {
                needsRespawn = true;
                this.playerControllers.delete(player.id); // Clear stale controller
              }
            } catch (e) {
              // Controller is invalid/disposed
              needsRespawn = true;
              this.playerControllers.delete(player.id);
            }
          }
        }

        if (needsRespawn) {
          this.spawnAttempts.set(player.id, 0);
          this.spawnWeaponsForPlayer(player);
        }
      }
    }, 5000); // Check every 5 seconds
  }
}

hz.Component.register(WeaponManager);
