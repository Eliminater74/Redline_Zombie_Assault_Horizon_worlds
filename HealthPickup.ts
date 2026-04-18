import * as hz from 'horizon/core';
import { Events } from 'Events';

class HealthPickup extends hz.Component<typeof HealthPickup> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity }, // Optional: Link specific trigger if needed
    pickupSFX: { type: hz.PropTypes.Entity }, 
    healAmount: { type: hz.PropTypes.Number, default: 2 },
  };

  private isCollected = false;

  start(): void {
    // 1. Trigger Logic
    // Use the linked trigger OR default to this entity itself
    const targetTrigger = this.props.trigger ?? this.entity;

    this.connectCodeBlockEvent(
      targetTrigger,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      this.onPlayerEnter.bind(this)
    );
    
    // 2. Rotation
    this.connectLocalBroadcastEvent(
      hz.World.onUpdate, 
      this.onUpdate.bind(this)
    );
  }

  private onPlayerEnter(player: hz.Player): void {
    if (this.isCollected) return;
    this.isCollected = true;

    // Send the Heal Event
    this.sendLocalBroadcastEvent(Events.healPlayer, { 
        amount: this.props.healAmount, 
        player: player 
    });

    // Play Sound
    if (this.props.pickupSFX) {
        const audio = this.props.pickupSFX.as(hz.AudioGizmo);
        if (audio) {
          // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
          audio.stop();
          audio.play();
        }
    }

    // Destroy
    this.world.deleteAsset(this.entity);
  }

  private onUpdate(data: { deltaTime: number }): void {
    // FIX: Skip if already collected/deleted
    if (this.isCollected) return;

    // FIX: Validate entity is still valid
    try {
        if (!this.entity.isValidReference.get()) return;
    } catch (e) { return; }

    const rotationSpeed = data.deltaTime * 2;
    const currentRot = this.entity.rotation.get();
    const rotChange = hz.Quaternion.fromAxisAngle(hz.Vec3.up, rotationSpeed);
    this.entity.rotation.set(currentRot.mul(rotChange));
  }
}

hz.Component.register(HealthPickup);