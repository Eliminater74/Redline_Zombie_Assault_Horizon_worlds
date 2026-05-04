import * as hz from 'horizon/core';
import * as nav from 'horizon/navmesh';

/**
 * ZOMBIE NAVIGATOR
 * Handles all pathfinding, predictive movement, flanking, and stuck detection
 * for the Zombie AI.
 * 
 * Decouples movement logic from the main Zombie.ts/Game Logic.
 */
export class ZombieNavigator {
  // CONFIGURATION
  private readonly destCacheThresholdSq = 0.25; // 0.5m tolerance (Was 4.0/2m)
  private readonly stuckCheckIntervalMs = 1500;
  private readonly stuckMovementThreshold = 0.08;
  private readonly stuckSpeedThreshold = 0.12;
  private readonly unstuckDirectChaseMs = 5000;
  private readonly hopelessStuckAttemptLimit = 24;
  private readonly longTermStuckWindowMs = 120000;
  private readonly longTermStuckDistanceThreshold = 1.5;
  private readonly longTermStuckHitLimit = 5;
  private readonly teleportRecoveryRadius = 4.5;
  
  // COMPONENTS
  private agent: nav.NavMeshAgent;
  private entity: hz.Entity;
  private navMesh: nav.INavMesh | null = null;

  // STATE
  private cachedDestination: hz.Vec3 | null = null;
  
  // FLANKING
  private flankAngle = 0;
  private lastFlankTime = 0;
  // Assigned once by Zombie.ts based on entity ID so groups spread naturally.
  private preferredFlankAngle: number | null = null;
  
  // PREDICTION
  private lastTargetPos: hz.Vec3 | null = null;
  private lastTargetTime = 0;

  // STUCK DETECTION
  private lastStuckCheckPos: hz.Vec3 | null = null;
  private lastStuckCheckTime = 0;
  private isUnstucking = false;
  private unstuckEndTime = 0;
  
  // FAILSAFE: Auto-Kill if stuck too long
  private stuckAttempts = 0;
  
  // LONG TERM STUCK CHECKS
  private longTermStuckPos: hz.Vec3 | null = null;
  private longTermStuckTime = 0;
  private longTermStuckHits = 0;

  // When unstuck logic runs, force direct chase briefly (disable flank weaving)
  private directChaseUntil = 0;

  public get isHopelesslyStuck(): boolean {
      return false;
  }
  
  // FAILSAFE FLAG
  private forceStuck = false;
  
  // SCRATCHPAD (GC Optimization)
  private scratchVec1 = new hz.Vec3(0, 0, 0);

  constructor(entity: hz.Entity, agent: nav.NavMeshAgent) {
    this.entity = entity;
    this.agent = agent;
    
    // Randomize stuck check offset for staggering
    this.lastStuckCheckTime = Date.now() - Math.floor(Math.random() * 3000);
  }

  /**
   * Called by Zombie.ts once at preStart to lock in this zombie's approach sector.
   * Distributes a group of zombies across 5 angular slots (-120°…+120°) so they
   * encircle the player instead of all charging from the same direction.
   */
  setPreferredFlankAngle(angle: number): void {
    this.preferredFlankAngle = angle;
  }

  /**
   * Called by Zombie.ts when server initializes or receives NavMesh
   */
  setNavMesh(mesh: nav.INavMesh) {
    this.navMesh = mesh;
  }

  /**
   * Resets all state (called on Zombie Revive)
   */
  reset() {
    this.cachedDestination = null;
    this.lastStuckCheckPos = null;
    this.isUnstucking = false;
    this.lastTargetPos = null;
    // FIX: Give 5 seconds grace period after spawn before checking for stuck
    this.lastStuckCheckTime = Date.now() + 5000;
    this.stuckAttempts = 0; // Reset Failsafe
    this.forceStuck = false; // Reset Loop Failsafe
    this.longTermStuckPos = null;
    this.longTermStuckTime = 0;
    this.longTermStuckHits = 0;
    this.directChaseUntil = 0;
    this.agent.clearDestination();
    
    // FIX: Force agent to acknowledge new position (resolves "Stuck in Wall" on spawn)
    try {
        // this.agent.warp(this.entity.position.get()); // API Not available
    } catch (e) { }
  }

  // LOD STATE
  private frameCount = Math.floor(Math.random() * 10); // Random offset for staggering

  /**
   * Main update loop for navigation.
   * Calculates where the zombie should move based on target or investigation point.
   * 
   * @param lodThrottle - How many frames to skip (1 = every frame, 10 = every 10th frame)
   */
  update(now: number, target: hz.Player | null, investigatePos: hz.Vec3 | null, lodThrottle: number = 1) {
     if (!this.navMesh) return;
     
     this.frameCount++;

     // Skip frames based on LOD passed from Zombie.ts
     if (this.frameCount % lodThrottle !== 0) return;

     // 1. HANDLE UNSTUCK MANEUVER
     if (this.isUnstucking) {
        if (now > this.unstuckEndTime) {
            this.isUnstucking = false;
        } else {
            return; // Busy wiggling free
        }
     }

     // 2. CHECK IF STUCK (Periodic)
      this.checkIfStuck(now, target);

     // 3. CALCULATE DESTINATION
     if (target) {
         this.moveTowardsTarget(now, target);
     } else if (investigatePos) {
         // Simple move to point
         this.moveTowardsPoint(investigatePos);
     } else {
         // IDLE WANDER
         this.checkIdleWander();
     }
  }

  /**
   * Advanced movement logic: Prediction + Flanking
   */
  private moveTowardsTarget(now: number, target: hz.Player) {
    const myPos = this.entity.position.get();
    const targetPos = target.position.get();
    let predictedPos = targetPos;
    
    // A. PREDICTION
    if (this.lastTargetPos && this.lastTargetTime > 0) {
        const deltaTime = (now - this.lastTargetTime) / 1000;
        if (deltaTime > 0 && deltaTime < 1) {
            const velocity = targetPos.sub(this.lastTargetPos).div(deltaTime);
            const prediction = velocity.mul(0.5); // 0.5s lookahead
            // HORIZON BUG WORKAROUND: Vec3.magnitude()/lengthSquared() broken in HW — use manual dot product.
            const predMagSq = prediction.x * prediction.x + prediction.y * prediction.y + prediction.z * prediction.z;
            if (predMagSq < 9) { // 3^2 = 9
                predictedPos = targetPos.add(prediction);
            }
        }
    }
    this.lastTargetPos = targetPos;
    this.lastTargetTime = now;

    // B. FLANKING (Dynamic)
    // HORIZON BUG WORKAROUND: Vec3.distanceSquared() broken in HW — use manual dot product.
    const _dtDx = myPos.x - targetPos.x, _dtDy = myPos.y - targetPos.y, _dtDz = myPos.z - targetPos.z;
    const distToTarget = Math.sqrt(_dtDx * _dtDx + _dtDy * _dtDy + _dtDz * _dtDz);
    
    // Stop flanking if very close, or right after an unstuck maneuver.
    if (distToTarget < 3.0 || now < this.directChaseUntil) {
        this.setAgentDestination(predictedPos);
        return;
    }

    // Update flank angle (2s – 5s cadence)
    if (now - this.lastFlankTime > (2000 + Math.random() * 3000)) {
        if (this.preferredFlankAngle !== null) {
            // Use this zombie's assigned sector + small random jitter so movement feels
            // natural while still spreading the group across different approach directions.
            this.flankAngle = this.preferredFlankAngle + (Math.random() * 24 - 12);
        } else {
            // Adaptive flank: wider in open space, narrower in corridors.
            const minAngle = distToTarget > 12 ? 20 : 8;
            const maxAngle = distToTarget > 12 ? 50 : 26;
            const sign = Math.random() < 0.5 ? -1 : 1;
            this.flankAngle = sign * (minAngle + Math.random() * (maxAngle - minAngle));
        }
        this.lastFlankTime = now;
    }

    let finalDestination = predictedPos;
    
    const toTarget = predictedPos.sub(myPos);
    const angleRad = this.flankAngle * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    
    const rotatedX = toTarget.x * cos - toTarget.z * sin;
    const rotatedZ = toTarget.x * sin + toTarget.z * cos;
    
    this.scratchVec1.x = rotatedX;
    this.scratchVec1.y = toTarget.y;
    this.scratchVec1.z = rotatedZ;
    finalDestination = myPos.add(this.scratchVec1);

    // C. SET DESTINATION (With Caching)
    this.setAgentDestination(finalDestination);
  }

  private moveTowardsPoint(pos: hz.Vec3) {
      this.setAgentDestination(pos);
  }

  private setAgentDestination(pos: hz.Vec3) {
    // Optimization: Only update if changed > threshold
    if (this.cachedDestination) {
        // HORIZON BUG WORKAROUND: Vec3.distanceSquared() broken in HW — use manual dot product.
        const _cdDx = pos.x - this.cachedDestination.x;
        const _cdDy = pos.y - this.cachedDestination.y;
        const _cdDz = pos.z - this.cachedDestination.z;
        const diff = _cdDx * _cdDx + _cdDy * _cdDy + _cdDz * _cdDz;
        if (diff < this.destCacheThresholdSq) return;
    }
    
    const nearest = this.navMesh!.getNearestPoint(pos, 2.0);
    if (nearest) {
        this.agent.destination.set(nearest);
        this.cachedDestination = pos;
    }
  }

  private checkIdleWander() {
      const currentSpeed = this.agent.currentSpeed.get();
      // If standing still
      if (currentSpeed < 0.1) {
          // 2% chance to wander - DISABLED to simplify logic
          // if (Math.random() < 0.02) { ... }
      }
  }

  private performUnstuck(now: number, target: hz.Player | null): void {
      if (!this.navMesh || this.isUnstucking) return;

      const myPos = this.entity.position.get();

      let dirX = 0;
      let dirZ = 1;
      if (target) {
          const targetPos = target.position.get();
          const dx = targetPos.x - myPos.x;
          const dz = targetPos.z - myPos.z;
          const mag = Math.sqrt(dx * dx + dz * dz);
          if (mag > 0.001) {
              dirX = dx / mag;
              dirZ = dz / mag;
          }
      }

      // HORIZON NAV WORKAROUND: Try multiple side-step candidates before giving up.
      // Zombies often wedge into corners or props with a valid path slightly to the left/right.
      const sideStep = 1.4 + Math.random() * 1.0;
      const backStep = 0.6 + Math.random() * 0.7;
      const forwardStep = 0.8 + Math.random() * 0.6;
      const strafeBias = Math.random() < 0.5 ? -1 : 1;

      const candidates = [
          new hz.Vec3(
              myPos.x + (-dirZ * strafeBias) * sideStep - dirX * backStep,
              myPos.y,
              myPos.z + (dirX * strafeBias) * sideStep - dirZ * backStep,
          ),
          new hz.Vec3(
              myPos.x + (-dirZ * -strafeBias) * sideStep - dirX * backStep,
              myPos.y,
              myPos.z + (dirX * -strafeBias) * sideStep - dirZ * backStep,
          ),
          new hz.Vec3(
              myPos.x - dirX * (backStep + 0.8),
              myPos.y,
              myPos.z - dirZ * (backStep + 0.8),
          ),
          new hz.Vec3(
              myPos.x + (-dirZ * strafeBias) * (sideStep * 0.7) + dirX * forwardStep,
              myPos.y,
              myPos.z + (dirX * strafeBias) * (sideStep * 0.7) + dirZ * forwardStep,
          ),
      ];

      let nearest: hz.Vec3 | null = null;
      for (const candidate of candidates) {
          const sampled = this.navMesh.getNearestPoint(candidate, 3.5);
          if (sampled) {
              nearest = sampled;
              break;
          }
      }
      if (!nearest) return;

      this.agent.clearDestination();
      this.agent.destination.set(nearest);
      this.cachedDestination = nearest;
      this.isUnstucking = true;
      this.unstuckEndTime = now + 1100;
      this.directChaseUntil = now + this.unstuckDirectChaseMs;
  }

  private teleportToNearestNavPoint(now: number, target: hz.Player | null): boolean {
      if (!this.navMesh) return false;

      const myPos = this.entity.position.get();
      let anchorPos = myPos;

      if (target) {
          try {
              anchorPos = target.position.get();
          } catch (e) {
              anchorPos = myPos;
          }
      }

      const sampled = this.navMesh.getNearestPoint(anchorPos, this.teleportRecoveryRadius)
        ?? this.navMesh.getNearestPoint(myPos, this.teleportRecoveryRadius)
        ?? this.navMesh.getNearestPoint(myPos, this.teleportRecoveryRadius + 2.5);

      if (!sampled) return false;

      try {
          this.agent.clearDestination();
          this.entity.position.set(sampled);
          this.cachedDestination = null;
          this.lastStuckCheckPos = sampled;
          this.lastStuckCheckTime = now;
          this.longTermStuckPos = sampled;
          this.longTermStuckTime = now;
          this.stuckAttempts = 0;
          this.longTermStuckHits = 0;
          this.forceStuck = false;
          this.isUnstucking = false;
          this.unstuckEndTime = 0;
          this.directChaseUntil = now + this.unstuckDirectChaseMs;
          return true;
      } catch (e) {
          return false;
      }
  }

  private checkIfStuck(now: number, target: hz.Player | null) {
      const hasTarget = target !== null;

      if (now < this.lastStuckCheckTime + this.stuckCheckIntervalMs) return;
      
      const myPos = this.entity.position.get();
      if (this.lastStuckCheckPos) {
          // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
          const _scDx = myPos.x - this.lastStuckCheckPos.x;
          const _scDy = myPos.y - this.lastStuckCheckPos.y;
          const _scDz = myPos.z - this.lastStuckCheckPos.z;
          const dist = Math.sqrt(_scDx * _scDx + _scDy * _scDy + _scDz * _scDz);
          const currentSpeed = this.agent.currentSpeed.get();

          // DEBUG: Print values to tune validation
          // console.log(`[ZombieNav] Check: Speed=${currentSpeed.toFixed(3)}, Dist=${dist.toFixed(3)}, HasTarget=${hasTarget}`);

          // AGGRESSIVE STUCK CONDITION:
          // If trying to move (Speed > 0.05) OR Has Target
          // AND hasn't moved 0.1m in the last second (Was 0.3).
          if ((currentSpeed > this.stuckSpeedThreshold || hasTarget) && dist < this.stuckMovementThreshold) {
              this.stuckAttempts++;
              // Try a sidestep/backstep maneuver before escalating.
              if (this.stuckAttempts >= 3) {
                   this.performUnstuck(now, target);
              }
              if (this.stuckAttempts >= this.hopelessStuckAttemptLimit) {
                   this.teleportToNearestNavPoint(now, target);
              }
          } else {
              // Reset if they managed to move
               this.stuckAttempts = 0;
          }
      }
      
      this.lastStuckCheckPos = myPos;
      this.lastStuckCheckTime = now;

      // --------------------------------------------------------
      // LONG TERM STUCK CHECK (90 Seconds)
      // --------------------------------------------------------
      // Catches zombies that are "moving" (jittering/sliding) but not going anywhere.
      if (!this.longTermStuckPos || now > this.longTermStuckTime + this.longTermStuckWindowMs) {
          if (this.longTermStuckPos) {
              // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
              const _ltDx = myPos.x - this.longTermStuckPos.x;
              const _ltDy = myPos.y - this.longTermStuckPos.y;
              const _ltDz = myPos.z - this.longTermStuckPos.z;
              const netDist = Math.sqrt(_ltDx * _ltDx + _ltDy * _ltDy + _ltDz * _ltDz);
              const isTryingToMove = this.agent.currentSpeed.get() > 0.1 || hasTarget;
              
              // console.log(`[ZombieNav] LongTerm Check (30s): NetDist=${netDist.toFixed(2)} vs Threshold=1.0`);

              // If trying to move but still in almost same area, try unstuck first.
              if (isTryingToMove && netDist < this.longTermStuckDistanceThreshold) {
                   this.longTermStuckHits++;
                   this.performUnstuck(now, target);

                   if (this.longTermStuckHits >= this.longTermStuckHitLimit) {
                       console.log("[ZombieNav] LONG TERM STUCK (Persistent). TELEPORTING.");
                       this.teleportToNearestNavPoint(now, target);
                   }
              } else {
                   this.longTermStuckHits = 0;
              }
          } else {
              // console.log("[ZombieNav] LongTerm Check: Initialized Position.");
          }
          this.longTermStuckPos = myPos;
          this.longTermStuckTime = now;
      }
  }
}
