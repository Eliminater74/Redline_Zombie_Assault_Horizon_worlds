import * as hz from 'horizon/core';
import { Events } from 'Events';
import { registerTransientEntityUpdate, unregisterTransientEntityUpdate } from 'TransientEntityUpdateHub';

const AMMO_BOX_TICK_MS = 100;
const AMMO_BOX_PROXIMITY_CHECK_MS = 200;

class AmmoBox extends hz.Component<typeof AmmoBox> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity },
    pickupSFX: { type: hz.PropTypes.Entity },
  };

  private waveCount = 0;
  private isCollected = false;
  private isDespawning = false;
  private lastDistanceCheck = 0;
  // One-shot timer to freeze physics after 3s (no need to check every frame).
  private kinematicTimer: number | null = null;
  // Visibility retry timers — prefab starts visible=false and the first set doesn't
  // always replicate to all clients before they render the entity.
  private visTimers: number[] = [];

  private isServer(): boolean {
    try {
      if (!this.entity.isValidReference.get()) return false;
      return this.entity.owner.get().id === this.world.getServerPlayer().id;
    } catch (e) { return false; }
  }

  start(): void {
    // Horizon replication bug: same-value visible.set(true) calls are no-ops — Horizon
    // deduplicates property sets and skips the replication packet if the value hasn't changed.
    // Toggle false→true forces a genuine state change each time, guaranteeing a new packet goes out.
    this.entity.visible.set(true);
    const forceVisible = () => {
      try {
        if (!this.isCollected && this.entity.isValidReference.get()) {
          this.entity.visible.set(false);
          this.entity.visible.set(true);
        }
      } catch {}
    };
    this.visTimers.push(this.async.setTimeout(forceVisible, 100));
    this.visTimers.push(this.async.setTimeout(forceVisible, 500));
    this.visTimers.push(this.async.setTimeout(forceVisible, 2000));
    this.visTimers.push(this.async.setTimeout(forceVisible, 5000));

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

    // HORIZON PERFORMANCE OPTIMIZATION: Register with the shared transient entity tick hub
    // instead of creating one interval per ammo box instance.
    registerTransientEntityUpdate(this.entity.id.toString(), this, AMMO_BOX_TICK_MS, this.onTick.bind(this));

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
    unregisterTransientEntityUpdate(this.entity.id.toString());
    if (this.kinematicTimer !== null) {
      this.async.clearTimeout(this.kinematicTimer);
      this.kinematicTimer = null;
    }
    this.visTimers.forEach(t => this.async.clearTimeout(t));
    this.visTimers = [];
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

    // Notify server-side tracking for the ammo leaderboard.
    if (this.isServer()) {
      this.sendLocalBroadcastEvent(Events.ammoPickedUp, { player });
    }

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

    // Rotate using the shared 100ms hub tick.
    try {
        const rotChange = hz.Quaternion.fromAxisAngle(hz.Vec3.up, 0.1 * Math.PI);
        this.entity.rotation.set(this.entity.rotation.get().mul(rotChange));
    } catch (e) { /* Entity is Static — stop rotating */ }

    // Proximity pickup check throttled to every 200ms.
    const now = Date.now();
    if (now - this.lastDistanceCheck < AMMO_BOX_PROXIMITY_CHECK_MS) return;
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
