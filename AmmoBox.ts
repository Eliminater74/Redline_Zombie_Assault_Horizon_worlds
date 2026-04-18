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
  private lastDistanceCheck = 0;

  // PERF FIX: Replaced World.onUpdate (60 FPS per instance) with a 50ms setInterval.
  // With 60 ammo boxes on the ground, onUpdate was firing 3600 times/sec just for rotation.
  private updateInterval: number | null = null;
  // One-shot timer to freeze physics after 3s (no need to check every frame).
  private kinematicTimer: number | null = null;

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
    this.connectNetworkBroadcastEvent(Events.despawnAmmo, this.onDespawnRequest.bind(this));
    this.connectNetworkBroadcastEvent(Events.forceCleanupAmmo, this.onForceCleanup.bind(this));

    // 3. Animation + proximity at 20 FPS (50ms) instead of 60 FPS per instance.
    this.updateInterval = this.async.setInterval(this.onTick.bind(this), 50);

    // 4. Freeze physics after 3 seconds to stop the engine solving collisions for idle boxes.
    this.kinematicTimer = this.async.setTimeout(() => {
      this.kinematicTimer = null;
      if (this.isCollected) return;
      try {
        if (this.entity.isValidReference.get()) {
          const body = this.entity as any;
          if (body.isKinematic) body.isKinematic.set(true);
        }
      } catch (e) {}
    }, 3000);
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.updateInterval !== null) {
      this.async.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.kinematicTimer !== null) {
      this.async.clearTimeout(this.kinematicTimer);
      this.kinematicTimer = null;
    }
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

    try {
        if (this.entity.isValidReference.get()) {
            this.entity.visible.set(false);
        }
    } catch (e) { /* Entity already deleted */ }

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

    try {
        this.sendNetworkBroadcastEvent(Events.despawnAmmo, { id: this.entity.id.toString() });
    } catch (e) { /* Entity invalid */ }
  }

  private onDespawnRequest(data: { id: string }): void {
    if (!this.isServer()) return;
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

  private onForceCleanup(_data: { keepCount: number }): void {
    if (this.isCollected) {
        this.despawn();
        return;
    }
    try {
        if (!this.entity.visible.get()) {
            this.isCollected = true;
            this.despawn();
        }
    } catch (e) { /* Entity invalid */ }
  }

  private onTick(): void {
    if (this.isCollected) return;

    try {
        if (!this.entity.isValidReference.get()) return;
    } catch (e) { return; }

    // Rotate (50ms interval = 0.05s delta equivalent)
    try {
        const rotChange = hz.Quaternion.fromAxisAngle(hz.Vec3.up, 0.05 * Math.PI);
        this.entity.rotation.set(this.entity.rotation.get().mul(rotChange));
    } catch (e) { /* Entity is Static — stop rotating */ }

    // Proximity pickup check throttled to every 200ms (every 4 ticks)
    const now = Date.now();
    if (now - this.lastDistanceCheck < 200) return;
    this.lastDistanceCheck = now;

    try {
        const player = this.world.getLocalPlayer();
        if (player) {
          const posA = player.position.get();
          const posB = this.entity.position.get();
          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const dz = posA.z - posB.z;
          if ((dx*dx + dy*dy + dz*dz) < 2.25) {
             this.onPlayerEnter(player);
          }
        }
    } catch(e) {}
  }
}

hz.Component.register(AmmoBox);
