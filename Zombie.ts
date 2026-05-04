import * as hz from 'horizon/core';
import * as nav from 'horizon/navmesh';
import * as uab from 'horizon/unity_asset_bundles';

import { alivePlayers, alivePlayerIds, playerHealthMap, ignoredPlayerIds, playerLookupMap, playerPositionCache } from 'GameState';
import { Events } from 'Events';
import { ZombieNavigator } from 'ZombieNav';
import { registerZombie, unregisterZombie, IUpdatable } from 'ZombieUpdateManager';

// Shared across all Zombie instances — tracks zombie count per target player for cooperative targeting in multiplayer.
const targetPressure = new Map<number, number>();

/**
 * ============================================================================
 * ZOMBIE AI CONTROLLER
 * ============================================================================
 *
 * This script handles all zombie behavior including:
 * - Target selection settings (Threat Scoring)
 * - Combat (attack timing, damage delivery, headshot detection)
 * - Death and revival (pooling-friendly design)
 * - Movement orchestration (delegated to ZombieNavigator)
 *
 * REFACTOR UPDATE: Movement logic moved to ZombieNav.ts for modularity.
 *
 * OPTIMIZATION UPDATE: Frame updates now managed by ZombieUpdateManager.
 * Instead of each zombie registering its own hz.World.onUpdate listener,
 * zombies register with a central manager that calls update() on all
 * zombies in a single loop. This reduces 900+ calls/sec to ~60 calls/sec.
 */
class Zombie extends hz.Component<typeof Zombie> implements IUpdatable {
  // ============================================================================
  // COMPONENT PROPERTIES (Set in Horizon Editor)
  // ============================================================================
  static propsDefinition = {
    /** The collider entity used for hit detection */
    collider: { type: hz.PropTypes.Entity },
    /** Asset to spawn as loot when zombie dies (e.g., health pickup) */
    healthDropAsset: { type: hz.PropTypes.Asset },
    /** Probability (0-1) that the zombie drops loot on death */
    dropChance: { type: hz.PropTypes.Number, default: 0.3 },
    /** Manual height offset to fix floating zombies (e.g. -0.1) */
    heightOffset: { type: hz.PropTypes.Number, default: 0 },
    /**
     * If true, snaps zombie to physics floor.
     * Disable for flying/floating zombies (Lich) so they use pure NavMesh height +/- offset.
     */
    snapToNavMesh: { type: hz.PropTypes.Boolean, default: true },
    /** Asset to spawn for floating damage numbers */
    floatingDamageAsset: { type: hz.PropTypes.Asset },
    /** 
     * OPTIONAL: Visual marker (light, glow, etc) to reveal zombie during Ghost Hunt.
     * Use a Light Gizmo or glowing asset.
     */
    ghostHuntMarker: { type: hz.PropTypes.Entity },
  };

  // ============================================================================
  // COMPONENT REFERENCES
  // ============================================================================

  /** NavMesh agent for pathfinding locomotion */
  private agent!: nav.NavMeshAgent;
  /** Animation controller from Unity Asset Bundle */
  private animations!: uab.AssetBundleInstanceReference;
  /** Navigation helper for movement logic */
  private navigator!: ZombieNavigator;

  // ============================================================================
  // STATE TRACKING
  // ============================================================================

  /** Whether the zombie is currently moving/chasing */
  private moving = false;
  /** Whether the zombie is alive (can attack, take damage) */
  private alive = true;
  /** Prevents double-death triggers during death animation */
  private isDead = false;
  /** Cached reference to the NavMesh for pathfinding queries */
  private navMesh: nav.INavMesh | null = null;
  /** Current health points (imported from WaveManager at spawn) */
  private currentHealth = 100;

  /** Injected spawn stats */
  private spawnHealth = 100;
  private spawnSpeed = 1.2;
  private spawnWave = 1;
  /** The player this zombie is currently targeting (sticky targeting) */
  private currentTarget: hz.Player | null = null;
  /** Recently hit-by player gets temporary aggro priority */
  private aggroTargetId: number | null = null;
  private aggroExpireTime = 0;
  /** Rampage mode flag - increases speed when health < 50% */
  private isRampaging = false;
  /** Hit rush flag - blocks updateBody from overwriting the burst speed. */
  private isHitRushing = false;
  /** Reference to the player within attack range */
  private closePlayer: hz.Player | null = null;

  // ============================================================================
  // COMBAT SETTINGS
  // ============================================================================

  /** Timestamp when the next attack is allowed */
  private nextAttackTime = 0;
  /** Milliseconds between attacks (2.5 seconds) */
  private attackCooldown = 2500;
  // HORIZON BUG WORKAROUND: Animation trigger flood guard — setAnimationParameterTrigger must not be called faster than 250ms.
  private lastAttackAnimTime = 0;
  /** Distance in meters at which attack can be performed */
  private attackRange = 2.5;
  // BUG FIX: Store attack animation timer handles so cleanup() can cancel them when zombie
  // is unloaded mid-attack, preventing callbacks from firing on a destroyed entity.
  private attackSpeedTimer: number | null = null;
  private attackDamageTimer: number | null = null;
  private reviveCollisionTimer: number | null = null;
  // HIT RUSH: Stores the handle so cleanup() can cancel it if zombie dies mid-burst.
  private hitRushTimer: number | null = null;
  private reviveGraceUntil = 0;
  private lastProcessedDamageSeq = 0;
  private lastProcessedGunshotSeq = 0;
  private deathSeq = 0;

  /** Timestamp of last proximity alert sent to HUD */
  private lastProximityCheckTime = 0;

  // ============================================================================
  // OPTIMIZATION: THROTTLING (Quest Performance)
  // ============================================================================

  /** Timestamp of last AI "think" cycle */
  private lastThinkTime = 0;
  /** Interval between AI updates in milliseconds (200ms = 5 FPS AI) */
  private readonly thinkInterval = 200;
  /** Cached think interval based on LOD */
  private currentThinkInterval = 200;
  /** Wave-scaled base think interval (updated at spawn, LOD throttles up from here) */
  private waveThinkInterval = 200;
  /** Timestamp of last LOD distance check */
  private lastLODCheckTime = 0;
  /** Throttle for navigation updates (1 = every frame, 10 = every 10th frame) */
  private currentNavThrottle = 1;

  // ============================================================================
  // OPTIMIZATION: ANIMATION DIRTY-FLAG
  // ============================================================================

  /** Last animation speed value sent to the animator */
  private lastAnimSpeed = 0;
  
  // ============================================================================
  // AI FEATURES: SOUND AWARENESS
  // ============================================================================

  /** Position to investigate (set when gunshots are heard) */
  private investigatePos: hz.Vec3 | null = null;
  /** When to stop investigating the sound */
  private investigateTimeout = 0;

  // ============================================================================
  // AMBIENT BEHAVIOR
  // ============================================================================

  /** Timestamp for next ambient moan sound */
  private nextMoanTime = 0;

  // PERF: Cached once in preStart() — zombie entity ownership never changes during a session.
  private _isServer = false;
  // Thin wrapper kept for call-site compatibility; delegates to cached field (1 read vs 2).
  private isServer(): boolean { return this._isServer; }

  // ============================================================================
  // IUpdatable INTERFACE IMPLEMENTATION
  // ============================================================================

  /**
   * Returns the unique entity ID for this zombie.
   * Required by IUpdatable interface for deduplication in the manager.
   */
  public getId(): bigint {
    return this.entity.id;
  }

  // ============================================================================
  // LIFECYCLE: PRE-START
  // ============================================================================

  preStart(): void {
    // PERF: Cache server-check once — avoids two property reads on every event handler call.
    this._isServer = this.world.getServerPlayer().id === this.entity.owner.get().id;
    this.agent = this.entity.as(nav.NavMeshAgent);

    // Initialize Navigation Helper
    this.navigator = new ZombieNavigator(this.entity, this.agent);

    const animGizmo = this.entity.as(uab.AssetBundleGizmo);
    if (animGizmo) {
        this.animations = animGizmo.getRoot();
    }

    // --- EVENT CONNECTIONS ---
    this.connectNetworkBroadcastEvent(Events.reviveZombie, this.reviveZombie.bind(this));
    this.connectNetworkEvent(this.entity, Events.hitZombie, this.hitZombie.bind(this));
    this.connectNetworkBroadcastEvent(Events.zombieHitAnim, this.zombieHitAnim.bind(this));
    this.connectNetworkBroadcastEvent(Events.zombieDeath, this.zombieDeath.bind(this));
    this.connectNetworkBroadcastEvent(Events.gunshot, this.onGunshot.bind(this));
    this.connectNetworkBroadcastEvent(Events.ghostHunt, this.onGhostHunt.bind(this));
    // AMMO SOUND AWARENESS: Ammo pickups make noise — nearby zombies investigate the position.
    this.connectLocalBroadcastEvent(Events.ammoPickedUp, this.onAmmoPickedUp.bind(this));


    // =========================================================================
    // OPTIMIZATION: Removed direct onUpdate hook
    // =========================================================================
    // BEFORE: this.connectLocalBroadcastEvent(hz.World.onUpdate, this.update.bind(this));
    //
    // Each zombie registering its own onUpdate listener caused 900+ function
    // calls per second (15 zombies * 60 FPS). Now zombies register with
    // ZombieUpdateManager which uses a single onUpdate hook to iterate all
    // zombies, reducing overhead to ~60 calls/sec.
    //
    // Registration happens in finishReviveClient() when zombie becomes active.
    // Unregistration happens in zombieDeath() when zombie dies.
    // =========================================================================
  }

  // ============================================================================
  // AI: SOUND AWARENESS
  // ============================================================================

  private onGunshot(data: { pos: hz.Vec3, seq?: number }): void {
    if (!this.alive || !this.isServer()) return;
    if (data.seq !== undefined && data.seq <= this.lastProcessedGunshotSeq) return;
    if (data.seq !== undefined) this.lastProcessedGunshotSeq = data.seq;

    const myPos = this.entity.position.get();
    // HORIZON BUG WORKAROUND: Vec3.lengthSquared() / distanceSquared() unsupported in HW runtime.
    // Using manual dot product instead. Do not revert to .distanceSquared().
    const gsDx = myPos.x - data.pos.x, gsDy = myPos.y - data.pos.y, gsDz = myPos.z - data.pos.z;
    const distSq = gsDx * gsDx + gsDy * gsDy + gsDz * gsDz;

    // HEARING RANGE: 30 meters (900 = 30^2)
    const ZOMBIE_HEARING_RANGE_SQ = 900;
    if (distSq > ZOMBIE_HEARING_RANGE_SQ) return;

    // Prioritize investigating if no target or shooter is close
    if (!this.currentTarget || distSq < 100) {
      this.investigatePos = data.pos;
      this.investigateTimeout = Date.now() + 5000;
    }
  }

  // ============================================================================
  // AI: AMMO SOUND AWARENESS
  // ============================================================================

  private onAmmoPickedUp(data: { player: hz.Player }): void {
    if (!this.alive || !this.isServer()) return;
    try {
      const playerPos = data.player.position.get();
      const myPos = this.entity.position.get();
      const dx = playerPos.x - myPos.x, dy = playerPos.y - myPos.y, dz = playerPos.z - myPos.z;
      // Investigate if within 22m (484 = 22^2) — ammo clinking is loud.
      if (dx * dx + dy * dy + dz * dz < 484) {
        this.investigatePos = playerPos;
        this.investigateTimeout = Date.now() + 4000;
      }
    } catch (e) {}
  }

  // ============================================================================
  // LIFECYCLE: START
  // ============================================================================

  start(): void {
    // Initialization handled in reviveZombie
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel attack timers in cleanup()
  // so they don't fire on an already-unloaded entity between the attack animation starting and landing.
  cleanup(): void {
    if (this.attackSpeedTimer !== null) {
      this.async.clearTimeout(this.attackSpeedTimer);
      this.attackSpeedTimer = null;
    }
    if (this.attackDamageTimer !== null) {
      this.async.clearTimeout(this.attackDamageTimer);
      this.attackDamageTimer = null;
    }
    if (this.reviveCollisionTimer !== null) {
      this.async.clearTimeout(this.reviveCollisionTimer);
      this.reviveCollisionTimer = null;
    }
    if (this.hitRushTimer !== null) {
      this.async.clearTimeout(this.hitRushTimer);
      this.hitRushTimer = null;
    }
    this.setTarget(null);
    unregisterZombie(this);
  }

  // ============================================================================
  // MAIN GAME LOOP
  // ============================================================================

  /**
   * Main update function called by ZombieUpdateManager each frame.
   * Contains throttling logic to reduce AI calculations to ~5 FPS.
   *
   * PUBLIC: Must be public so ZombieUpdateManager can call it.
   */
  // ============================================================================
  // MAIN GAME LOOP
  // ============================================================================

  /**
   * Main update function called by ZombieUpdateManager each frame.
   * Splits logic into "Body" (Movement/Anim - High Freq) and "Brain" (Logic - Low Freq).
   */
  public update(): void {
    // 1. VALIDATION
    try {
        if (!this.entity.isValidReference.get()) {
            unregisterZombie(this);
            return;
        }
    } catch (e) {
        unregisterZombie(this);
        return;
    }

    // 2. VISIBILITY WATCHDOG
    if (this.alive && !this.entity.visible.get()) {
        this.entity.visible.set(true);
        try { 
            const col = this.props.collider as any;
            if (col && col.isValidReference.get() && !col.as(hz.TriggerGizmo)) col.collidable.set(true);
        } catch (e) {}
    }

    if (!this.moving || !this.navMesh || !this.alive) return;

    const now = Date.now();
    const myPos = this.entity.position.get();

    // -------------------------------------------------------------------------
    // BRAIN UPDATE (Low Frequency - Target Selection, State Changes)
    // -------------------------------------------------------------------------
    if (now - this.lastThinkTime > this.currentThinkInterval) {
        this.lastThinkTime = now;
        this.updateBrain(now, myPos);
    }

    // -------------------------------------------------------------------------
    // BODY UPDATE (High Frequency - Movement, Animation, Attack)
    // -------------------------------------------------------------------------
    this.updateBody(now, myPos);
  }

  /**
   * Heavy logic: Target selection, LOD calculations, State checks.
   * Runs every 200-1000ms depending on LOD.
   */
  private updateBrain(now: number, myPos: hz.Vec3): void {
      // 1. LOD CALCULATION
      if (now - this.lastLODCheckTime > 1000) {
          this.lastLODCheckTime = now;
          this.calculateLOD(myPos);
      }

      // 2. TARGET ACQUISITION
      // Optimization: Only scan for targets if we don't have one OR every 2s
      // Currently runs every brain update (200ms) which is fine for responsiveness
      const potentialTargets = this.getPotentialTargets();
      
      if (potentialTargets.length === 0) {
          this.closePlayer = null;
          // Navigator handles wandering handled in Body
          return;
      }

      // 3. AMBIENT SOUNDS
      if (now >= this.nextMoanTime) {
          this.sendLocalBroadcastEvent(Events.zombieMoan, { pos: myPos });
          this.nextMoanTime = now + 8000 + Math.random() * 12000;
      }

      // 4. PICK TARGET
      // PERF: Pass myPos down so updateTargetSelection doesn't re-fetch entity.position.get().
      this.updateTargetSelection(now, myPos, potentialTargets);
  }

  /**
   * Fast logic: Animation smoothing, Position updates, Attacks.
   * Runs every frame (or throttled slightly by Manager).
   */
  private updateBody(now: number, myPos: hz.Vec3): void {
      // 1. UPRIGHT CORRECTION (Prevent tipping)
      const rot = this.entity.rotation.get();
      if (Math.abs(rot.x) > 0.1 || Math.abs(rot.z) > 0.1) {
          const euler = rot.toEuler();
          this.entity.rotation.set(hz.Quaternion.fromEuler(new hz.Vec3(0, euler.y, 0)));
      }

      // 2. ANIMATION SYNC
      const currentSpeed = this.agent.currentSpeed.get();
      const speedDelta = Math.abs(currentSpeed - this.lastAnimSpeed);
      if (speedDelta > 0.1) {
          this.animations?.setAnimationParameterFloat("Speed", currentSpeed);
          this.lastAnimSpeed = currentSpeed;
      }

      // 3. MOVEMENT (Delegate to Navigator)
      // Note: Navigator has its own internal LOD for path recalculations
      this.navigator.update(now, this.currentTarget, this.investigatePos, this.currentNavThrottle);

      // FAILSAFE
      if (this.navigator.isHopelesslyStuck) {
           this.death();
           return;
      }

      // 4. COMBAT PROXIMITY CHECK (Lunge / Attack)
      if (this.currentTarget) {
            // HORIZON BUG WORKAROUND: Vec3.distanceSquared() unsupported in HW runtime.
          // Using manual dot product instead. Do not revert.
          const ctPos = this.currentTarget.position.get();
          const ctDx = ctPos.x - myPos.x, ctDy = ctPos.y - myPos.y, ctDz = ctPos.z - myPos.z;
          const distSq = ctDx * ctDx + ctDy * ctDy + ctDz * ctDz;

          // Attack Range Check
          if (distSq <= (this.attackRange * this.attackRange)) {
               this.closePlayer = this.currentTarget;
          } else {
               this.closePlayer = null;
          }

          // Lunge Logic (Sprint if close) — skip if hit rush or rampage already controls speed.
          if (!this.isRampaging && !this.isHitRushing) {
              if (distSq < 25) { // < 5m
                   this.agent.maxSpeed.set(this.spawnSpeed * 1.5);
              } else {
                   this.agent.maxSpeed.set(this.spawnSpeed);
              }
          }
      } else {
          this.closePlayer = null;
          if (!this.isRampaging && !this.isHitRushing) this.agent.maxSpeed.set(this.spawnSpeed);
      }

      // 5. TRY ATTACK
      this.tryAttack(now);
  }

  private calculateLOD(myPos: hz.Vec3) {
      this.currentThinkInterval = this.waveThinkInterval; // Wave-scaled base
      this.currentNavThrottle = 1; // Default every frame

      if (alivePlayers.length > 0) {
          let closestDistSq = Infinity;
          for (const p of alivePlayers) {
              // HORIZON BUG WORKAROUND: Vec3.distanceSquared() unsupported in HW runtime.
              // Using manual dot product instead. Do not revert.
              const pPos = playerPositionCache.get(p.id) ?? p.position.get();
              const lodDx = pPos.x - myPos.x, lodDy = pPos.y - myPos.y, lodDz = pPos.z - myPos.z;
              const d = lodDx * lodDx + lodDy * lodDy + lodDz * lodDz;
              if (d < closestDistSq) closestDistSq = d;
          }

          // BRAIN LOD: throttle at distance but scale from wave-scaled base
          if (closestDistSq > 900) { // > 30m
              this.currentThinkInterval = Math.round(this.waveThinkInterval * 2.5);
          }

          // NAV LOD
          if (closestDistSq > 900) { // > 30m
               this.currentNavThrottle = 10;
          } else if (closestDistSq > 400) { // > 20m (Was 10m/100)
               this.currentNavThrottle = 3;
          }
      }
  }

  // ============================================================================
  // IDLE BEHAVIOR
  // ============================================================================

  /**
   * Returns the list of potential targets for this zombie.
   * Prefers alive players, falls back to all players if none alive.
   */
  private getPotentialTargets(): hz.Player[] {
      const cachedPlayers = Array.from(playerLookupMap.values());
      const source = alivePlayers.length > 0 ? alivePlayers : (cachedPlayers.length > 0 ? cachedPlayers : this.world.getPlayers());
      const filtered = source.filter(p => !ignoredPlayerIds.has(p.id));
      return filtered.length > 0 ? filtered : source;
  }

  // ============================================================================
  // TARGET SELECTION
  // ============================================================================

  /**
   * Updates this.currentTarget based on Threat Scoring.
   * Does NOT handle movement (handled by Navigator).
   *
   * THREAT SCORING FORMULA:
   * score = distance - (healthBonus)
   * healthBonus = (10 - currentHP) * 1.5
   *
   * Lower scores = higher priority targets.
   * Wounded players are prioritized over healthy ones.
   */
  private setTarget(newTarget: hz.Player | null): void {
      if (this.currentTarget?.id === newTarget?.id) return;
      if (this.currentTarget !== null) {
          const prev = targetPressure.get(this.currentTarget.id) ?? 0;
          targetPressure.set(this.currentTarget.id, Math.max(0, prev - 1));
      }
      this.currentTarget = newTarget;
      if (newTarget !== null) {
          targetPressure.set(newTarget.id, (targetPressure.get(newTarget.id) ?? 0) + 1);
      }
  }

  // PERF: myPos passed from updateBrain() to avoid re-reading entity.position.get() every brain tick.
  private updateTargetSelection(now: number, myPos: hz.Vec3, potentialTargets: hz.Player[]): void {

    // If recently damaged by a player, strongly bias target scoring toward attacker.
    let activeAggroTargetId: number | null = null;
    if (this.aggroTargetId !== null && now < this.aggroExpireTime) {
        activeAggroTargetId = this.aggroTargetId;
    } else {
        this.aggroTargetId = null;
    }

    // Validate current target still exists
    if (this.currentTarget) {
        if (!potentialTargets.some(p => p.id === this.currentTarget!.id)) {
            // Remember last known position so zombie pursues even after target disappears.
            try {
                if (!this.investigatePos) {
                    this.investigatePos = this.currentTarget.position.get();
                    this.investigateTimeout = Date.now() + 8000;
                }
            } catch {}
            this.setTarget(null);
        }
    }

    // Clear expired investigation
    if (this.investigatePos && now > this.investigateTimeout) {
        this.investigatePos = null;
    }

    // Threat Scoring
    let bestTarget: hz.Player | null = null;
    let bestScore = Infinity;
    let closestPlayer: hz.Player | null = null;
    let closestDistSq = Infinity;

    for (const player of potentialTargets) {
        if (!player) continue;

        // PERF: Hoist pPos so it's accessible in the proximity check below without a second .get() call.
        let pPos: hz.Vec3 = hz.Vec3.zero;
        let distSq = Infinity;
        try {
            // HORIZON BUG WORKAROUND: Vec3.distanceSquared() unsupported in HW runtime.
            // Using manual dot product instead. Do not revert.
            pPos = player.position.get();
            const tdx = pPos.x - myPos.x, tdy = pPos.y - myPos.y, tdz = pPos.z - myPos.z;
            distSq = tdx * tdx + tdy * tdy + tdz * tdz;
        } catch (e) { continue; }

        const dist = Math.sqrt(distSq);

        // Track closest player as fallback
        if (distSq < closestDistSq) {
            closestDistSq = distSq;
            closestPlayer = player;
        }

        // Calculate threat score (lower = more attractive target)
        // Small ID-based jitter reduces robot-like "all pick same target" behavior.
        const hp = playerHealthMap.get(player.id) ?? 10;
        const healthBonus = (10 - hp) * 1.5;
        const antiClumpJitter = (player.id % 7) * 0.12;
        const aggroBonus = activeAggroTargetId !== null && player.id === activeAggroTargetId ? -6 : 0;
        // Cooperative targeting: in multiplayer, penalize players that already have many zombies on them.
        const pressure = potentialTargets.length > 1 ? (targetPressure.get(player.id) ?? 0) : 0;
        const score = dist - healthBonus + antiClumpJitter + aggroBonus + pressure * 2.0;

        if (score < bestScore) {
            bestScore = score;
            bestTarget = player;
        }

        // Proximity Alert: Notify HUD when zombie is close to player (400 = 20m^2)
        // HORIZON BUG WORKAROUND: distSq already computed via manual dot product above.
        const PROXIMITY_ALERT_RANGE_SQ = 400;
        if (distSq < PROXIMITY_ALERT_RANGE_SQ && now > this.lastProximityCheckTime + 250) {
            // PERF: pPos already fetched above — reuse it instead of calling player.position.get() again.
            const yDiff = Math.abs(pPos.y - myPos.y);
            if (yDiff < 10.0) {
                this.sendLocalBroadcastEvent(Events.zombieProximity, {
                    dist: dist,
                    pos: myPos,
                    id: this.entity.id.toString(),
                    targetId: player.id.toString()
                });
                this.lastProximityCheckTime = now;
            }
        }
    }

    // Fallback to closest if no threat-scored target
    if (!bestTarget && closestPlayer) {
        bestTarget = closestPlayer;
    }

    if (!bestTarget) {
        this.setTarget(null);
        return;
    }

    // Sticky Targeting: Only switch targets if new target is significantly better
    if (!this.currentTarget) {
        this.setTarget(bestTarget);
    } else if (bestTarget.id !== this.currentTarget.id) {
        // Only switch if score improves by at least 5 points
        // HORIZON BUG WORKAROUND: Vec3.distanceSquared() unsupported in HW runtime.
        // Using manual dot product instead. Do not revert.
        const stCtPos = this.currentTarget.position.get();
        const stDx = stCtPos.x - myPos.x, stDy = stCtPos.y - myPos.y, stDz = stCtPos.z - myPos.z;
        const currentDistSq = stDx * stDx + stDy * stDy + stDz * stDz;
        const currentHp = playerHealthMap.get(this.currentTarget.id) ?? 10;
        const currentJitter = (this.currentTarget.id % 7) * 0.12;
        const currentAggroBonus = activeAggroTargetId !== null && this.currentTarget.id === activeAggroTargetId ? -6 : 0;
        const currentScore = Math.sqrt(currentDistSq) - (10 - currentHp) * 1.5 + currentJitter + currentAggroBonus;

        if (bestScore < currentScore - 5) {
            this.setTarget(bestTarget);
        }
    }

    // Clear investigation when we have a valid target
    if (this.currentTarget) {
        this.investigatePos = null;
    }
  }

  // ============================================================================
  // POOLING: REVIVAL
  // ============================================================================

  /**
   * Called when WaveManager wants to revive/spawn this zombie.
   * Handles both server-side and client-side initialization.
   */
  reviveZombie(data: { zombie: hz.Entity, health?: number, speed?: number, wave?: number, position?: hz.Vec3 }): void {
    // FIX: Validate entity references before comparing IDs
    try {
        if (!data.zombie.isValidReference.get()) return;
        if (!this.entity.isValidReference.get()) return;
        // Ignore events for other zombies
        if (data.zombie.id !== this.entity.id) return;
    } catch (e) { return; }

    // Apply spawn stats if provided
    if (data.health) this.spawnHealth = data.health;
    if (data.speed) this.spawnSpeed = data.speed;
    if (data.wave) this.spawnWave = data.wave;

    // Server-side initialization
    if (this.isServer()) {
        if (!this.navMesh) {
          // First spawn - need to fetch NavMesh
          this.agent.getNavMesh().then(mesh => {
            if (mesh) {
                this.navMesh = mesh;
                this.navigator.setNavMesh(mesh);
                this.finishReviveServer();
            }
          });
        } else {
          // Subsequent spawns - NavMesh already cached
          this.finishReviveServer();
        }
    }

    // Client-side initialization (runs on all clients including server)
    this.finishReviveClient(data.position);
  }

  /**
   * Server-side revival logic.
   * Sets up NavMesh positioning, agent settings, and resets state.
   */
  finishReviveServer(): void {
    if (!this.navMesh) return;

    // Snap to NavMesh
    const pos = this.entity.position.get();
    const nearest = this.navMesh.getNearestPoint(pos, 5.0);
    if (nearest) {
      this.entity.position.set(nearest);
    }

    // FIX: Immediately face the nearest player to prevent walking into walls
    const players = Array.from(playerLookupMap.values());
    const sourcePlayers = players.length > 0 ? players : this.world.getPlayers();
    if (sourcePlayers.length > 0) {
        let nearestPlayer = null as (hz.Player | null);
        let minDstSq = Infinity;
        const myPos = this.entity.position.get();

        sourcePlayers.forEach(p => {
            // HORIZON BUG WORKAROUND: Using manual dot product for squared distance. Do not use .distanceSquared().
            const pPos = playerPositionCache.get(p.id) ?? p.position.get();
            const dx = pPos.x - myPos.x, dy = pPos.y - myPos.y, dz = pPos.z - myPos.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < minDstSq) {
                minDstSq = d;
                nearestPlayer = p;
            }
        });

        if (nearestPlayer) {
            this.entity.lookAt(nearestPlayer.position.get());
        }
    }

    // Reset NavMesh Agent Settings
    this.agent.maxSpeed.set(this.spawnSpeed);
    this.agent.isImmobile.set(false);
    this.agent.avoidanceMask.set(1);
    this.agent.avoidanceLayer.set(1);
    this.agent.avoidanceRadius.set(0.5);
    this.agent.usePhysicalSurfaceSnapping.set(this.props.snapToNavMesh);
    this.agent.baseOffset.set(this.props.heightOffset);
    // FIX: Removed duplicate baseOffset.set call (was causing unnecessary overhead)

    // Reset Combat State
    this.currentHealth = this.spawnHealth;
    this.closePlayer = null;
    this.setTarget(null);
    this.aggroTargetId = null;
    this.aggroExpireTime = 0;
    this.isRampaging = false;
    this.isHitRushing = false;
    this.nextAttackTime = 0;
    this.isDead = false;
    if (this.hitRushTimer !== null) {
      this.async.clearTimeout(this.hitRushTimer);
      this.hitRushTimer = null;
    }

    // Wave-scaled aggression: faster attacks, wider reach, quicker brain at higher waves (caps at wave 30).
    const waveT = Math.min((this.spawnWave - 1) / 29, 1.0);
    this.attackCooldown = Math.round(2500 - waveT * 800);    // 2500ms → 1700ms
    this.attackRange = 2.5 + waveT * 0.5;                   // 2.5m → 3.0m
    this.waveThinkInterval = Math.round(200 - waveT * 80);   // 200ms → 120ms
    this.currentThinkInterval = this.waveThinkInterval;

    // Reset Staggering logic (AI Tick Offset for performance)
    // Random offset prevents all zombies from thinking on the same frame
    this.lastThinkTime = Date.now() - Math.floor(Math.random() * this.thinkInterval);

    // Reset Navigator (handles Staggering for Stuck Checks internally)
    this.navigator.reset();

    this.lastAnimSpeed = 0;
  }

  /**
   * Client-side revival logic.
   * Makes zombie visible, enables collider, starts animations.
   * Also registers with ZombieUpdateManager to receive update() calls.
   */
  finishReviveClient(pos?: hz.Vec3): void {
    // Set position if provided
    if (pos) this.entity.position.set(pos);

    // Set alive state
    this.alive = true;
    this.moving = true;
    this.isDead = false; // FIX: Ensure death flag is cleared on client
    this.reviveGraceUntil = Date.now() + 100;
    this.lastProcessedDamageSeq = 0;
    this.entity.visible.set(true);

    // HORIZON BUG WORKAROUND: Freshly spawned entities can have collision/raycast desync for 1-2 frames.
    // Keep the collider disabled briefly, then enable it after a short grace period.
    try {
       const collider = this.props.collider as any;
       if (collider && collider.isValidReference?.get() && !collider.as(hz.TriggerGizmo)) {
          collider.collidable.set(false);
       }
    } catch(e) { /* Ignore invalid entity errors */ }
    if (this.reviveCollisionTimer !== null) {
      this.async.clearTimeout(this.reviveCollisionTimer);
    }
    this.reviveCollisionTimer = this.async.setTimeout(() => {
      this.reviveCollisionTimer = null;
      try {
        const collider = this.props.collider as any;
        if (this.alive && collider && collider.isValidReference?.get() && !collider.as(hz.TriggerGizmo)) {
          collider.collidable.set(true);
        }
      } catch (e) { /* Ignore invalid entity errors */ }
    }, 50);

    // Start animations
    this.animations?.setAnimationParameterBool("Moving", true);
    this.animations?.setAnimationParameterBool("Death", false);

    // =========================================================================
    // OPTIMIZATION: Register with centralized update manager
    // =========================================================================
    // This zombie will now receive update() calls from ZombieUpdateManager
    // instead of having its own hz.World.onUpdate listener.
    // =========================================================================
    registerZombie(this);
  }

  // ============================================================================
  // DAMAGE HANDLING
  // ============================================================================

  /**
   * Called when this zombie takes damage.
   * Handles headshot detection, damage multipliers, and death triggering.
   */
  hitZombie(data: { damage: number, instigator?: hz.Player, hitPos?: hz.Vec3, seq?: number }): void {
    if (!this.isServer()) return;
    if (!this.alive || this.isDead) return;
    if (Date.now() < this.reviveGraceUntil) return;
    if (data.seq !== undefined && data.seq <= this.lastProcessedDamageSeq) return;
    if (data.seq !== undefined) this.lastProcessedDamageSeq = data.seq;

    // Switch target to attacker if they're a valid player
    if (data.instigator && alivePlayerIds.has(data.instigator!.id)) {
        this.setTarget(data.instigator);
        this.aggroTargetId = data.instigator.id;
        this.aggroExpireTime = Date.now() + 7000;
    }

    let finalDamage = data.damage;

    // HEADSHOT DETECTION: Check if hit position is above zombie's head height
    if (data.hitPos) {
        const myY = this.entity.position.get().y;
        if ((data.hitPos.y - myY) > 1.6) {
             // Calculate wave-scaled headshot multiplier
             let multiplier = 2;
             if (this.spawnWave >= 40) multiplier = 7;
             else if (this.spawnWave >= 30) multiplier = 6;
             else if (this.spawnWave >= 20) multiplier = 5;
             else if (this.spawnWave >= 10) multiplier = 4;
             else if (this.spawnWave >= 4) multiplier = 3;

             finalDamage *= multiplier;

             // Notify HUD for headshot indicator
             if (data.instigator && this.isServer()) {
                 try {
                     this.sendLocalBroadcastEvent(Events.playerHeadshot, { player: data.instigator });
                 } catch (e) { }
             }
        }
    }

    // Apply damage
    this.currentHealth = Math.max(0, this.currentHealth - finalDamage);

    // Check for death
    if (this.currentHealth <= 0) {
      this.death(data.instigator);
      return;
    }

    // HIT RUSH: Wounded-animal speed burst for 1.5s when struck.
    // Makes kiting dangerous — hitting a zombie causes it to lunge faster briefly.
    if (this.hitRushTimer !== null) this.async.clearTimeout(this.hitRushTimer);
    this.isHitRushing = true;
    this.agent.maxSpeed.set(this.spawnSpeed * 1.9);
    this.hitRushTimer = this.async.setTimeout(() => {
        this.hitRushTimer = null;
        this.isHitRushing = false;
        try {
            if (this.alive && this.entity.isValidReference.get()) {
                this.agent.maxSpeed.set(this.isRampaging ? this.spawnSpeed * 1.3 : this.spawnSpeed);
            }
        } catch (e) {}
    }, 1500);

    // RAMPAGE MODE: Speed boost when health drops below 50%
    if (this.currentHealth < (this.spawnHealth / 2) && !this.isRampaging) {
        this.isRampaging = true;
        this.agent.maxSpeed.set(this.spawnSpeed * 1.3);
    }

    // FLOATING DAMAGE NUMBER
    if (this.props.floatingDamageAsset) {
        const offset = new hz.Vec3(
            (Math.random() - 0.5) * 0.5, 
            1.6 + Math.random() * 0.5, 
            (Math.random() - 0.5) * 0.5
        );
        const spawnPos = (data.hitPos || this.entity.position.get()).add(offset);
        
        // HORIZON BUG WORKAROUND: SpawnGizmo null checks — spawnAsset can return null/empty; always null-check.
        this.world.spawnAsset(this.props.floatingDamageAsset, spawnPos).then(entities => {
             if (!entities || entities.length === 0) return;
             const spawnedEntity = entities[0];
             if (!spawnedEntity) return;
             this.sendNetworkEvent(spawnedEntity, Events.initFloatingDamage, {
                 amount: finalDamage,
                 isHeadshot: finalDamage > data.damage
             });
        }).catch(e => {
             console.error("[Zombie] Failed to spawn floating damage:", e);
        });
    }

    // Trigger hit animation on all clients
    this.sendNetworkBroadcastEvent(Events.zombieHitAnim, { zombie: this.entity });
  }

  /**
   * Plays the hit reaction animation.
   * Called via network broadcast so all clients see it.
   */
  zombieHitAnim(data: { zombie: hz.Entity }): void {
    // FIX: Validate entity references before comparing IDs
    try {
        if (!data.zombie.isValidReference.get()) return;
        if (data.zombie.id !== this.entity.id) return;
    } catch (e) { return; }
    this.animations?.setAnimationParameterTrigger("Hit");
  }

  // ============================================================================
  // DEATH & DROPS
  // ============================================================================

  /**
   * Initiates zombie death sequence.
   * Tries to spawn loot and broadcasts death event to all clients.
   */
  death(killer?: hz.Player): void {
    // Prevent double-death
    if (this.isDead) return;
    this.isDead = true;

    this.trySpawnLoot();
    this.sendNetworkBroadcastEvent(Events.zombieDeath, {
        zombie: this.entity,
        killer: killer,
        deathPos: this.entity.position.get(),
        // HORIZON BUG WORKAROUND: Broadcast ordering is not guaranteed.
        // A per-zombie death sequence lets listeners ignore duplicate or stale death packets.
        seq: ++this.deathSeq,
    });
  }

  /**
   * Handles zombie death on all clients.
   * Plays death animation, disables movement, and unregisters from update manager.
   */
  zombieDeath(data: { zombie: hz.Entity, killer?: hz.Player }): void {
    // FIX: Validate entity references before comparing IDs
    try {
        if (!data.zombie.isValidReference.get()) return;
        if (!this.entity.isValidReference.get()) return;
        // Ignore events for other zombies
        if (data.zombie.id !== this.entity.id) return;
    } catch (e) { return; }

    // Play death animation
    this.animations?.setAnimationParameterBool("Moving", false);
    this.animations?.setAnimationParameterBool("Death", true);

    // Stop movement (server only)
    if (this.isServer()) {
        this.agent.clearDestination();
        this.agent.isImmobile.set(true);
        this.setTarget(null);
    }

    // Update state
    this.moving = false;
    this.alive = false;
    this.closePlayer = null;

    // Disable collider
    try {
        const collider = (this.props.collider as any);
        // FIX: Validate collider entity before accessing properties
        if (collider && collider.isValidReference?.get() && !collider.as(hz.TriggerGizmo)) {
             collider.collidable?.set(false);
        }
    } catch(e) { /* Ignore invalid entity errors */ }

    // =========================================================================
    // OPTIMIZATION: Unregister from centralized update manager
    // =========================================================================
    // Dead zombies don't need update() calls, so we unregister to save CPU.
    // They will re-register when revived via finishReviveClient().
    // =========================================================================
    unregisterZombie(this);
  }

  /**
   * Attempts to spawn loot (health pickup) at zombie's death position.
   * Respects the dropChance probability setting.
   */
  private trySpawnLoot(): void {
      if (this.props.healthDropAsset) {
          if (Math.random() < this.props.dropChance) {
              // HORIZON BUG WORKAROUND: SpawnGizmo null checks — always handle potential null result from spawnAsset.
              this.world.spawnAsset(this.props.healthDropAsset, this.entity.position.get())
                .catch(e => console.error("[Zombie] Failed to spawn health drop:", e));
          }
      }
  }

  // ============================================================================
  // COMBAT ACTIONS
  // ============================================================================

  /**
   * Checks if zombie can attack and initiates attack if conditions are met.
   */
  private tryAttack(now: number): void {
      // Check attack conditions
      if (!this.closePlayer || !this.alive || now < this.nextAttackTime) return;

      // Validate target reference
      if (!this.closePlayer.isValidReference.get()) {
        this.closePlayer = null;
        return;
      }

      this.performAttack(now);
  }

  /**
   * Executes the attack sequence.
   * Includes lunge animation, attack cooldown, and damage delivery.
   */
  private performAttack(now: number): void {
      // Set cooldown
      this.nextAttackTime = now + this.attackCooldown;

      // Lunge forward
      this.agent.maxSpeed.set(this.spawnSpeed * 2.0);
      // HORIZON BUG WORKAROUND: Animation trigger flood guard — setAnimationParameterTrigger must not be called faster than 250ms.
      if (now - this.lastAttackAnimTime >= 250) {
        this.animations?.setAnimationParameterTrigger("Attack");
        this.lastAttackAnimTime = now;
      }

      // Play attack sound
      this.sendNetworkBroadcastEvent(Events.attackSFX, {
        pos: this.entity.position.get(),
      });

      // Stop lunge after 300ms
      if (this.attackSpeedTimer !== null) this.async.clearTimeout(this.attackSpeedTimer);
      this.attackSpeedTimer = this.async.setTimeout(() => {
          this.attackSpeedTimer = null;
          // FIX: Validate entity before accessing agent (prevents "Entity ID not valid" errors)
          try {
              if (this.alive && this.entity.isValidReference.get()) {
                  this.agent.maxSpeed.set(0);
              }
          } catch (e) { /* Entity was unloaded */ }
      }, 300);

      // Damage check at 625ms (animation timing)
      if (this.attackDamageTimer !== null) this.async.clearTimeout(this.attackDamageTimer);
      this.attackDamageTimer = this.async.setTimeout(() => {
          this.attackDamageTimer = null;
        // FIX: Validate entity before accessing properties
        try {
            if (!this.entity.isValidReference.get()) return;
        } catch (e) { return; }

        // Resume appropriate speed (respect hit rush / rampage if still active).
        if (this.alive) this.agent.maxSpeed.set(
            this.isHitRushing ? this.spawnSpeed * 1.9 :
            this.isRampaging  ? this.spawnSpeed * 1.3 :
            this.spawnSpeed
        );

        // Check if target is still in range
        const target = this.closePlayer;
        if (target && this.alive && target.isValidReference.get()) {
             // HORIZON BUG WORKAROUND: Vec3.distanceSquared() unsupported in HW runtime.
             const tgtPos = target.position.get();
             const entPos = this.entity.position.get();
             const adx = tgtPos.x - entPos.x, ady = tgtPos.y - entPos.y, adz = tgtPos.z - entPos.z;
             const dist = adx * adx + ady * ady + adz * adz;
             if (dist <= (this.attackRange * this.attackRange) + 1) {
                 if (this.isServer()) {
                     // Deal damage to player
                     this.sendLocalBroadcastEvent(Events.hitPlayer, {
                        player: target,
                        pos: this.entity.position.get(),
                     });
                 }
             }
        }
      }, 625);
  }

  /**
   * Toggles the visual marker for Ghost Hunt mode.
   * This provides "Proof of Life" to players when a wave is stuck.
   */
  private onGhostHunt(data: { enabled: boolean }): void {
      if (!this.alive) return;
      
      const marker = this.props.ghostHuntMarker;
      if (marker && marker.isValidReference.get()) {
          // Toggle visibility of the marker entity
          marker.visible.set(data.enabled);
      }
  }
}

hz.Component.register(Zombie);

/**
 * ============================================================================
 * ZOMBIE COLLISION HELPER
 * ============================================================================
 *
 * Helper component that forwards hit events from sub-colliders to the main zombie.
 * Attach this to any child collider that should trigger damage.
 *
 * UPDATE: Now automatically handles collision state for death/revival to prevent
 * "Invisible Shield" bug blocking ammo pickups.
 */
class ZombieCollision extends hz.Component<typeof ZombieCollision> {
  static propsDefinition = {
    /** Reference to the parent zombie entity */
    zombie: { type: hz.PropTypes.Entity }
  };

  start(): void { }

  preStart(): void {
    // Forward hit events to the parent zombie
    this.connectNetworkEvent(this.entity, Events.hitZombie, this.hitZombie.bind(this));

    // Listen for death to disable this collider
    this.connectNetworkBroadcastEvent(Events.zombieDeath, this.onZombieDeath.bind(this));

    // Listen for revival to re-enable this collider
    this.connectNetworkBroadcastEvent(Events.reviveZombie, this.onRevive.bind(this));
  }

  /**
   * Forwards damage events from this collider to the parent zombie.
   */
  hitZombie(data: { damage: number, instigator?: hz.Player, hitPos?: hz.Vec3 }): void {
    try {
      // FIX: Validate entity references before forwarding events
      if (!this.props.zombie) return;
      if (!this.props.zombie.isValidReference.get()) return;

      this.sendNetworkEvent(this.props.zombie, Events.hitZombie, {
        damage: data.damage,
        instigator: data.instigator,
        hitPos: data.hitPos
      });
    } catch (e) { /* Ignore invalid entity errors */ }
  }

  /**
   * Disables this collider when parent zombie dies.
   * Prevents "invisible shield" blocking pickups.
   */
  onZombieDeath(data: { zombie: hz.Entity }) {
      try {
          // FIX: Validate all entity references before accessing
          if (!this.props.zombie) return;
          if (!data.zombie.isValidReference.get()) return;
          if (!this.props.zombie.isValidReference.get()) return;
          if (!this.entity.isValidReference.get()) return;

          if (data.zombie.id !== this.props.zombie.id) return;

          // Skip static entities that can't have collision toggled
          const name = this.entity.name.get();
          if (name.includes("Static") || name.includes("MageCollider")) return;

          this.entity.collidable.set(false);
      } catch (e) { /* Ignore entity errors */ }
  }

  /**
   * Re-enables this collider when parent zombie is revived.
   */
  onRevive(data: { zombie: hz.Entity }) {
      try {
          // FIX: Validate all entity references before accessing
          if (!this.props.zombie) return;
          if (!data.zombie.isValidReference.get()) return;
          if (!this.props.zombie.isValidReference.get()) return;
          if (!this.entity.isValidReference.get()) return;

          if (data.zombie.id !== this.props.zombie.id) return;

          // Skip static entities that can't have collision toggled
          const name = this.entity.name.get();
          if (name.includes("Static") || name.includes("MageCollider")) return;

          this.entity.collidable.set(true);
      } catch (e) { /* Ignore entity errors */ }
  }
}

hz.Component.register(ZombieCollision);
