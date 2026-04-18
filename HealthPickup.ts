import * as hz from 'horizon/core';
import { Events } from 'Events';

class HealthPickup extends hz.Component<typeof HealthPickup> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity }, // Optional: Link specific trigger if needed
    pickupSFX: { type: hz.PropTypes.Entity }, 
    healAmount: { type: hz.PropTypes.Number, default: 2 },
  };

  private isCollected = false;
  // PERF FIX: Replaced World.onUpdate (60fps) with a 50ms interval (20fps) — spin animation only.
  private updateInterval: number | null = null;
  private static readonly TICK_DT = 0.05;

  start(): void {
    const targetTrigger = this.props.trigger ?? this.entity;

    this.connectCodeBlockEvent(
      targetTrigger,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      this.onPlayerEnter.bind(this)
    );

    this.updateInterval = this.async.setInterval(() => this.onTick(), 50);
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel in cleanup().
  cleanup(): void {
    if (this.updateInterval !== null) {
      this.async.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private onPlayerEnter(player: hz.Player): void {
    if (this.isCollected) return;
    this.isCollected = true;

    this.sendLocalBroadcastEvent(Events.healPlayer, {
        amount: this.props.healAmount,
        player: player
    });

    if (this.props.pickupSFX) {
        const audio = this.props.pickupSFX.as(hz.AudioGizmo);
        if (audio) {
          // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
          audio.stop();
          audio.play();
        }
    }

    this.world.deleteAsset(this.entity);
  }

  private onTick(): void {
    if (this.isCollected) return;

    try {
        if (!this.entity.isValidReference.get()) return;
    } catch (e) { return; }

    const rotChange = hz.Quaternion.fromAxisAngle(hz.Vec3.up, HealthPickup.TICK_DT * 2);
    this.entity.rotation.set(this.entity.rotation.get().mul(rotChange));
  }
}

hz.Component.register(HealthPickup);