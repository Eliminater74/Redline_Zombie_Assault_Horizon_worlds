import * as hz from 'horizon/core';
import { Events } from 'Events';
import { registerTransientEntityUpdate, unregisterTransientEntityUpdate } from 'TransientEntityUpdateHub';

const HEALTH_PICKUP_TICK_MS = 100;

class HealthPickup extends hz.Component<typeof HealthPickup> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity }, // Optional: Link specific trigger if needed
    pickupSFX: { type: hz.PropTypes.Entity }, 
    healAmount: { type: hz.PropTypes.Number, default: 2 },
  };

  private isCollected = false;
  private static readonly TICK_DT = 0.1;

  start(): void {
    const targetTrigger = this.props.trigger ?? this.entity;

    this.connectCodeBlockEvent(
      targetTrigger,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      this.onPlayerEnter.bind(this)
    );

    // HORIZON PERFORMANCE OPTIMIZATION: Use the shared transient entity tick hub
    // so health drops don't each create their own interval.
    registerTransientEntityUpdate(this.entity.id.toString(), this, HEALTH_PICKUP_TICK_MS, this.onTick.bind(this));
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel in cleanup().
  cleanup(): void {
    unregisterTransientEntityUpdate(this.entity.id.toString());
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
