import * as hz from 'horizon/core';

/**
 * MOVING PLATFORM
 * Moves an entity between waypoints or randomly.
 */
class MovingPlatform extends hz.Component<typeof MovingPlatform> {
  static propsDefinition = {
    waypoint1: { type: hz.PropTypes.Entity },
    waypoint2: { type: hz.PropTypes.Entity },
    waypoint3: { type: hz.PropTypes.Entity },
    waypoint4: { type: hz.PropTypes.Entity },
    waypoint5: { type: hz.PropTypes.Entity },
    waypoint6: { type: hz.PropTypes.Entity },
    waypoint7: { type: hz.PropTypes.Entity },
    waypoint8: { type: hz.PropTypes.Entity },
    waypoint9: { type: hz.PropTypes.Entity },
    waypoint10: { type: hz.PropTypes.Entity },
    
    speed: { type: hz.PropTypes.Number, default: 2.0 },
    pauseTime: { type: hz.PropTypes.Number, default: 2.0 },
    
    // Random Mode: 0 = Off, 1 = Full 3D, 2 = Flat (X/Z only)
    randomMode: { type: hz.PropTypes.Number, default: 0 },
    randomRadius: { type: hz.PropTypes.Number, default: 15 }, 
    randomMinHeight: { type: hz.PropTypes.Number, default: 5 },
    randomMaxHeight: { type: hz.PropTypes.Number, default: 15 },
  };

  private waypoints: hz.Vec3[] = [];
  private currentTargetIndex = 0;
  private isPaused = false;
  private updateInterval: number | null = null;
  private startPos: hz.Vec3 = hz.Vec3.zero;
  private targetPos: hz.Vec3 | null = null; // Fix: Allow null for safety check

  start() {
    this.startPos = this.entity.position.get();

    // 1. Collect Valid Waypoints
    const wps = [
        this.props.waypoint1, this.props.waypoint2, this.props.waypoint3,
        this.props.waypoint4, this.props.waypoint5, this.props.waypoint6,
        this.props.waypoint7, this.props.waypoint8, this.props.waypoint9, this.props.waypoint10
    ];
    this.waypoints = [];
    for (const wp of wps) {
        if (wp) this.waypoints.push(wp.position.get());
    }

    // 2. Initialize State
    if (this.waypoints.length > 0) {
        // WAYPOINT MODE
        // Snap to first waypoint
        this.entity.position.set(this.waypoints[0]);
        
        // Target is the SECOND waypoint (or loop back to first if only 1, but we checked length)
        this.currentTargetIndex = 1 % this.waypoints.length;
        this.targetPos = this.waypoints[this.currentTargetIndex];
    } else {
        // RANDOM MODE
        if (this.props.randomMode > 0) {
            this.pickRandomTarget();
        } else {
            console.log("[MovingPlatform] No waypoints & Random Mode OFF. Stay put.");
            return; 
        }
    }

    // 3. Start Update Loop (20 FPS)
    this.updateInterval = this.async.setInterval(this.onUpdate.bind(this), 50);
  }

  onUpdate() {
    if (this.isPaused || !this.targetPos) return;

    const currentPos = this.entity.position.get();
    
    // Safety check: ensure target is valid
    // In Waypoint Mode, refresh target from array in case it changed (unlikely but safe)
    if (this.waypoints.length > 0) {
        this.targetPos = this.waypoints[this.currentTargetIndex];
    }

    // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
    const _mpDx = this.targetPos.x - currentPos.x, _mpDy = this.targetPos.y - currentPos.y, _mpDz = this.targetPos.z - currentPos.z;
    const dist = Math.sqrt(_mpDx * _mpDx + _mpDy * _mpDy + _mpDz * _mpDz);
    const moveStep = this.props.speed * 0.05; // speed * deltaTime (0.05s)

    if (dist <= moveStep) {
        // ARRIVED
        this.entity.position.set(this.targetPos);
        this.startPause();
    } else {
        // MOVE
        const rawDir = this.targetPos.sub(currentPos);
        // HORIZON BUG WORKAROUND: Guard .normalize() calls — check length > 0 before normalizing.
        const rawDirLenSq = rawDir.x * rawDir.x + rawDir.y * rawDir.y + rawDir.z * rawDir.z;
        const direction = rawDirLenSq > 0.0001 ? rawDir.normalize() : hz.Vec3.forward;
        const newPos = currentPos.add(direction.mul(moveStep));
        this.entity.position.set(newPos);
    }
  }

  startPause() {
    this.isPaused = true;
    this.async.setTimeout(() => {
        this.isPaused = false;
        
        if (this.waypoints.length > 0) {
            this.currentTargetIndex = (this.currentTargetIndex + 1) % this.waypoints.length;
            this.targetPos = this.waypoints[this.currentTargetIndex];
        } else if (this.props.randomMode > 0) {
            this.pickRandomTarget();
        }
    }, this.props.pauseTime * 1000);
  }

  pickRandomTarget() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * this.props.randomRadius;
    const height = this.props.randomMinHeight + 
                   Math.random() * (this.props.randomMaxHeight - this.props.randomMinHeight);
    
    // Relative to START POS height or absolute?
    // Let's keep it robust: Use absolute Y from startPos + offset?
    // User complaint implies unexpected Y. Let's assume startPos Y is "ground".
    // Random Mode 1: Full 3D (varies height)
    // Random Mode 2: Flat (keeps start height)
    const newY = (this.props.randomMode === 1) 
        ? this.startPos.y + height 
        : this.startPos.y;

    this.targetPos = new hz.Vec3(
      this.startPos.x + Math.cos(angle) * radius,
      newY,
      this.startPos.z + Math.sin(angle) * radius
    );
    
    // If they want height variation:
    // this.targetPos.y = this.startPos.y + height; 
    // Commented out height variation to prevent "diving" or "flying" logic for now. 
    // Let's stick to X/Z plane wandering for safety unless requested.
  }

  dispose() {
      if (this.updateInterval) {
          this.async.clearInterval(this.updateInterval);
      }
  }
}

hz.Component.register(MovingPlatform);
