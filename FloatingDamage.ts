import * as hz from 'horizon/core';
import { Events } from 'Events';

class FloatingDamage extends hz.Component<typeof FloatingDamage> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity }, // Optional trigger functionality if needed? Standard convention.
    textGizmo: { type: hz.PropTypes.Entity }, // The TextGizmo displaying the number
  };

  private startTime = 0;
  private startPos: hz.Vec3 = hz.Vec3.zero;
  private initialized = false;
  private lifeTime = 1500; // 1.5 seconds

  start() {
    this.connectNetworkEvent(this.entity, Events.initFloatingDamage, this.onInit.bind(this));
    this.connectLocalBroadcastEvent(hz.World.onUpdate, this.onUpdate.bind(this));
    
    // Immediately clear text to prevent "FloatingDamage" flash on spawn
    try {
        if (this.props.textGizmo && this.props.textGizmo.isValidReference.get()) {
            const text = this.props.textGizmo.as(hz.TextGizmo);
            if (text) text.text.set(""); 
        }
    } catch(e) {}

    // Safety cleanup if never initialized
    this.async.setTimeout(() => {
        if (!this.initialized) {
             if (this.isServer()) this.world.deleteAsset(this.entity);
        }
    }, 2000);
  }

  private isServer(): boolean {
    try {
        if (!this.entity.isValidReference.get()) return false;
        return this.entity.owner.get().id === this.world.getServerPlayer().id;
    } catch (e) { return false; }
  }

  /**
   * Called via Network Event to set damage amount and style.
   */
  private onInit(data: { amount: number, isHeadshot: boolean }) {
    this.initialized = true;
    this.startTime = Date.now();
    this.startPos = this.entity.position.get();

    // Setup Text
    try {
        if (this.props.textGizmo && this.props.textGizmo.isValidReference.get()) {
            const text = this.props.textGizmo.as(hz.TextGizmo);
            if (text) {
                // Formatting
                const amount = Math.round(data.amount);
                text.text.set(amount.toString());

                // 1. BILLBOARD: Look at local player
                const localPlayer = this.world.getLocalPlayer();
                if (localPlayer) {
                    const toPlayer = localPlayer.position.get().sub(this.entity.position.get());
                    // Simply rotate to look at player. Text is usually +Z or -Z.
                    // We'll trust lookRotation to +Z.
                    this.entity.rotation.set(hz.Quaternion.lookRotation(toPlayer, hz.Vec3.up).mul(hz.Quaternion.fromEuler(new hz.Vec3(0, 180, 0))));
                }
                // Styling
                if (data.isHeadshot) {
                    text.color.set(new hz.Color(1, 0, 0)); // Red
                    this.entity.scale.set(new hz.Vec3(0.5, 0.5, 0.5)); // Smaller Headshot (was 0.7)
                } else {
                    text.color.set(new hz.Color(0, 1, 0)); // Green (was White)
                    this.entity.scale.set(new hz.Vec3(0.25, 0.25, 0.25)); // Smaller Normal (was 0.4)
                }
            }
        }
    } catch(e) {}
    
    // Schedule destruction
    if (this.isServer()) {
        this.async.setTimeout(() => {
            try {
                if (this.entity.isValidReference.get()) {
                    this.world.deleteAsset(this.entity);
                }
            } catch (e) {}
        }, this.lifeTime);
    }
  }

  private onUpdate(data: { deltaTime: number }) {
      if (!this.initialized) return;

      try {
          if (!this.entity.isValidReference.get()) return;

          const now = Date.now();
          const progress = (now - this.startTime) / this.lifeTime;
          
          if (progress >= 1.0) return;



          // 2. FLOAT UPWARDS
          // Move up 1.5m over lifetime
          const yOffset = progress * 1.5;
          const currentPos = this.startPos.add(new hz.Vec3(0, yOffset, 0));
          this.entity.position.set(currentPos);

          // 3. FADE OUT (Not supported on all gizmos, skipping for reliability)
          // If TextGizmo supports alpha, we could do:
          // text.color.set(new hz.Color(r, g, b, 1.0 - progress));
      } catch (e) {}
  }
}

hz.Component.register(FloatingDamage);
