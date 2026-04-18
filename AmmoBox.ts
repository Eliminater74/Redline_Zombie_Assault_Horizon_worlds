import * as hz from 'horizon/core';
import { Events } from 'Events';

class AmmoBox extends hz.Component<typeof AmmoBox> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity },
    pickupSFX: { type: hz.PropTypes.Entity }, 
  };

  private waveCount = 0;
  private isCollected = false;
  private isDespawning = false;
  private lastDistanceCheck = 0; // Throttle distance checks
  private spawnTime = 0;
  private isKinematic = false;

  private isServer(): boolean {
    try {
      if (!this.entity.isValidReference.get()) return false;
      return this.entity.owner.get().id === this.world.getServerPlayer().id;
    } catch (e) { return false; }
  }

  start(): void {
    // 1. Trigger Logic
    if (this.props.trigger) {
      this.connectCodeBlockEvent(
        this.props.trigger,
        hz.CodeBlockEvents.OnPlayerEnterTrigger,
        this.onPlayerEnter.bind(this)
      );
    }

    // 2. Game Logic
    this.connectNetworkBroadcastEvent(Events.endGame, this.despawn.bind(this));
    this.connectLocalBroadcastEvent(Events.newWave, this.onNewWave.bind(this));
    this.connectNetworkBroadcastEvent(Events.despawnAmmo, this.onDespawnRequest.bind(this)); // FIX: Listen for cleanup requests
    this.connectNetworkBroadcastEvent(Events.forceCleanupAmmo, this.onForceCleanup.bind(this)); // FIX: Wave-start purge

    // 3. Animation Logic (Fixed for your API version)
    // We use the Global World Broadcast for updates, not CodeBlockEvents
    this.connectLocalBroadcastEvent(
      hz.World.onUpdate, 
      this.onUpdate.bind(this)
    );
    this.spawnTime = Date.now();
  }

  private onNewWave(_data: { wave: number }): void {
    if (++this.waveCount >= 2) {
      this.despawn();
    }
  }

  private onPlayerEnter(player: hz.Player): void {
    if (this.isCollected || this.isDespawning) return;
    this.isCollected = true;

    this.sendNetworkEvent(player, Events.giveAmmo, {});

    // CLIENT: Instant feedback (hide and silent)
    try {
        if (this.entity.isValidReference.get()) {
            this.entity.visible.set(false);
        }
    } catch (e) { /* Entity already deleted */ }

    // Disable collision to prevent re-trigger
    // FIX: Validate trigger entity before accessing collidable
    try {
        if (this.props.trigger && this.props.trigger.isValidReference.get()) {
           this.props.trigger.collidable.set(false);
        }
    } catch (e) { /* Trigger entity invalid */ }

    try {
        if (this.props.pickupSFX) {
            const audio = this.props.pickupSFX.as(hz.AudioGizmo);
            if (audio) {
              // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
              audio.stop();
              audio.play();
            }
        }
    } catch (e) { /* Audio entity invalid */ }

    // SERVER: Request actual deletion
    try {
        this.sendNetworkBroadcastEvent(Events.despawnAmmo, { id: this.entity.id.toString() });
    } catch (e) { /* Entity invalid */ }
  }

  private onDespawnRequest(data: { id: string }): void {
    if (!this.isServer()) return;
    // FIX: Validate entity before accessing ID
    try {
        if (!this.entity.isValidReference.get()) return;
        if (data.id === this.entity.id.toString()) {
           this.despawn();
        }
    } catch (e) { /* Entity already invalid */ }
  }

  private despawn(): void {
    if (this.isDespawning) return;

    this.isDespawning = true;
    this.isCollected = true;

    try {
        if (this.entity.isValidReference.get()) {
            this.entity.visible.set(false);
        }
    } catch (e) { /* Entity invalid */ }

    try {
        if (this.props.trigger && this.props.trigger.isValidReference.get()) {
            this.props.trigger.collidable.set(false);
        }
    } catch (e) { /* Trigger entity invalid */ }

    if (!this.isServer()) return;

    try {
        if (this.entity.isValidReference.get()) {
            this.world.deleteAsset(this.entity);
        }
    } catch (e) { /* Entity already deleted */ }
  }

  /**
   * Force cleanup handler - called at wave start to purge invisible/collected ammo.
   * Each ammo box checks itself and requests deletion if it should be removed.
   */
  private onForceCleanup(data: { keepCount: number }): void {
    // If already collected/invisible, delete self
    if (this.isCollected) {
        this.despawn();
        return;
    }

    // If we're invisible but not marked collected (edge case), delete
    try {
        if (!this.entity.visible.get()) {
            this.isCollected = true;
            this.despawn();
        }
    } catch (e) { /* Entity invalid */ }
  }

  private onUpdate(data: { deltaTime: number }): void {
    // FIX: Skip update if entity was already collected/deleted
    if (this.isCollected) return;

    // FIX: Validate entity is still valid before accessing properties
    try {
        if (!this.entity.isValidReference.get()) return;
    } catch (e) { return; }

    const rotationSpeed = data.deltaTime * Math.PI;
    const currentRot = this.entity.rotation.get();

    // Rotate around UP axis
    // Rotate around UP axis
    try {
        const rotChange = hz.Quaternion.fromAxisAngle(hz.Vec3.up, rotationSpeed);
        this.entity.rotation.set(currentRot.mul(rotChange));
    } catch (e) { 
        // Entity is Static; stop trying to animate it
    }

    // RELIABILITY FIX: Manual Distance Check (THROTTLED for performance)
    // Only check every 200ms
    const now = Date.now();
    
    // PHYSICS OPTIMIZATION: Sleep after 3 seconds
    // If not already kinematic, and 3s have passed since spawn, make it kinematic
    // This stops the physics engine from solving collisions for thousands of stationary boxes.
    if (!this.isCollected && !this.isKinematic && now > this.spawnTime + 3000) {
        this.isKinematic = true;
        try {
            if (this.entity.isValidReference.get()) {
                 // Horizon API uses 'as(hz.PhysicsGizmo)' or direct property access depending on version.
                 // Assuming standard entity physics properties here if Gizmo fails.
                 // If PhysicsGizmo is not exported, we use 'any' cast as fallback to access isKinematic.
                 const body = this.entity as any; 
                 if (body.isKinematic) body.isKinematic.set(true);
            }
        } catch (e) {}
    }

    if (now - this.lastDistanceCheck < 200) return;
    this.lastDistanceCheck = now;

    try {
        const player = this.world.getLocalPlayer();
        if (player) {
          const posA = player.position.get();
          const posB = this.entity.position.get();
          // Fast distance check (avoid sqrt)
          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const dz = posA.z - posB.z;

          if ((dx*dx + dy*dy + dz*dz) < 2.25) { // 1.5m radius
             this.onPlayerEnter(player);
          }
        }
    } catch(e) {} // Ignore player not found errors
  }
}

hz.Component.register(AmmoBox);
