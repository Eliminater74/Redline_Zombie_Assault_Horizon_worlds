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
  
  // COMPONENTS
  private agent: nav.NavMeshAgent;
  private entity: hz.Entity;
  private navMesh: nav.INavMesh | null = null;

  // STATE
  private cachedDestination: hz.Vec3 | null = null;
  
  // FLANKING
  private flankAngle = 0;
  private lastFlankTime = 0;
  
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
      return this.stuckAttempts > 10 || this.forceStuck; // Check both counters
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

    // Update flank angle randomly (2s - 5s)
    if (now - this.lastFlankTime > (2000 + Math.random() * 3000)) {
        // Adaptive flank: wider in open space, narrower in corridors.
        const minAngle = distToTarget > 12 ? 20 : 8;
        const maxAngle = distToTarget > 12 ? 50 : 26;
        const sign = Math.random() < 0.5 ? -1 : 1;
        const angle = minAngle + Math.random() * (maxAngle - minAngle);
        this.flankAngle = sign * angle;
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

      const sideSign = Math.random() < 0.5 ? -1 : 1;
      const sideX = -dirZ * sideSign;
      const sideZ = dirX * sideSign;

      const sideStep = 1.3 + Math.random() * 0.9;
      const backStep = 0.5 + Math.random() * 0.6;

      const candidate = new hz.Vec3(
          myPos.x + sideX * sideStep - dirX * backStep,
          myPos.y,
          myPos.z + sideZ * sideStep - dirZ * backStep,
      );

      const nearest = this.navMesh.getNearestPoint(candidate, 3.0);
      if (!nearest) return;

      this.agent.destination.set(nearest);
      this.cachedDestination = nearest;
      this.isUnstucking = true;
      this.unstuckEndTime = now + 900;
      this.directChaseUntil = now + 4000;
  }

  private checkIfStuck(now: number, target: hz.Player | null) {
      const hasTarget = target !== null;

      // Check more frequently (1s)
      if (now < this.lastStuckCheckTime + 1000) return;
      
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
          if ((currentSpeed > 0.05 || hasTarget) && dist < 0.1) {
              this.stuckAttempts++;
              // Try a sidestep/backstep maneuver before escalating.
              if (this.stuckAttempts >= 3) {
                   this.performUnstuck(now, target);
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
      if (!this.longTermStuckPos || now > this.longTermStuckTime + 90000) { // Increased from 30s
          if (this.longTermStuckPos) {
              // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
              const _ltDx = myPos.x - this.longTermStuckPos.x;
              const _ltDy = myPos.y - this.longTermStuckPos.y;
              const _ltDz = myPos.z - this.longTermStuckPos.z;
              const netDist = Math.sqrt(_ltDx * _ltDx + _ltDy * _ltDy + _ltDz * _ltDz);
              const isTryingToMove = this.agent.currentSpeed.get() > 0.1 || hasTarget;
              
              // console.log(`[ZombieNav] LongTerm Check (30s): NetDist=${netDist.toFixed(2)} vs Threshold=1.0`);

              // If trying to move but still in almost same area, try unstuck first.
              if (isTryingToMove && netDist < 1.0) {
                   this.longTermStuckHits++;
                   this.performUnstuck(now, target);

                   if (this.longTermStuckHits >= 3) {
                       console.log("[ZombieNav] LONG TERM STUCK (Persistent). KILLING. 💀");
                       this.forceStuck = true;
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
