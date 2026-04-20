import * as hz from 'horizon/core';
import { Events } from 'Events';
import { registerTransientEntityUpdate, unregisterTransientEntityUpdate } from 'TransientEntityUpdateHub';

const FLOATING_DAMAGE_TICK_MS = 100;

class FloatingDamage extends hz.Component<typeof FloatingDamage> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity },
    textGizmo: { type: hz.PropTypes.Entity },
  };

  private startTime = 0;
  private startPos: hz.Vec3 = hz.Vec3.zero;
  private initialized = false;
  private lifeTime = 1500; // ms

  // BUG FIX: Store both timeout handles so cleanup() can cancel them.
  private safetyTimer: number | null = null;
  private destroyTimer: number | null = null;

  start() {
    this.connectNetworkEvent(this.entity, Events.initFloatingDamage, this.onInit.bind(this));

    // Clear text immediately to prevent "FloatingDamage" flash on spawn.
    try {
        if (this.props.textGizmo && this.props.textGizmo.isValidReference.get()) {
            const text = this.props.textGizmo.as(hz.TextGizmo);
            if (text) text.text.set("");
        }
    } catch(e) {}

    // Safety: delete self if never initialized (e.g. network event lost).
    this.safetyTimer = this.async.setTimeout(() => {
        this.safetyTimer = null;
        if (!this.initialized) {
            if (this.isServer()) this.world.deleteAsset(this.entity);
        }
    }, 2000);
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    unregisterTransientEntityUpdate(this.entity.id.toString());
    if (this.safetyTimer !== null) {
      this.async.clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (this.destroyTimer !== null) {
      this.async.clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
  }

  private isServer(): boolean {
    try {
        if (!this.entity.isValidReference.get()) return false;
        return this.entity.owner.get().id === this.world.getServerPlayer().id;
    } catch (e) { return false; }
  }

  private onInit(data: { amount: number, isHeadshot: boolean }) {
    this.initialized = true;
    this.startTime = Date.now();
    this.startPos = this.entity.position.get();

    try {
        if (this.props.textGizmo && this.props.textGizmo.isValidReference.get()) {
            const text = this.props.textGizmo.as(hz.TextGizmo);
            if (text) {
                text.text.set(Math.round(data.amount).toString());

                const localPlayer = this.world.getLocalPlayer();
                if (localPlayer) {
                    const toPlayer = localPlayer.position.get().sub(this.entity.position.get());
                    this.entity.rotation.set(hz.Quaternion.lookRotation(toPlayer, hz.Vec3.up).mul(hz.Quaternion.fromEuler(new hz.Vec3(0, 180, 0))));
                }

                if (data.isHeadshot) {
                    text.color.set(new hz.Color(1, 0, 0));
                    this.entity.scale.set(new hz.Vec3(0.5, 0.5, 0.5));
                } else {
                    text.color.set(new hz.Color(0, 1, 0));
                    this.entity.scale.set(new hz.Vec3(0.25, 0.25, 0.25));
                }
            }
        }
    } catch(e) {}

    // HORIZON PERFORMANCE OPTIMIZATION: Use the shared transient entity tick hub
    // instead of one interval per floating number.
    registerTransientEntityUpdate(this.entity.id.toString(), this, FLOATING_DAMAGE_TICK_MS, this.onTick.bind(this));

    // Schedule deletion on server side.
    if (this.isServer()) {
        this.destroyTimer = this.async.setTimeout(() => {
            this.destroyTimer = null;
            try {
                if (this.entity.isValidReference.get()) {
                    this.world.deleteAsset(this.entity);
                }
            } catch (e) {}
        }, this.lifeTime);
    }
  }

  private onTick(): void {
    try {
        if (!this.entity.isValidReference.get()) return;

        const progress = (Date.now() - this.startTime) / this.lifeTime;
        if (progress >= 1.0) return;

        // Float upward 1.5m over lifetime.
        this.entity.position.set(this.startPos.add(new hz.Vec3(0, progress * 1.5, 0)));
    } catch (e) {}
  }
}

hz.Component.register(FloatingDamage);
