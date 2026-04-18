import * as hz from 'horizon/core';

/**
 * SpinningLogo
 * Makes an entity spin (rotate) and optionally "bob" (float up and down).
 * Useful for logos, pickups, and floating signs.
 */
class SpinningLogo extends hz.Component<typeof SpinningLogo> {
  static propsDefinition = {
    spinSpeed: { type: hz.PropTypes.Number, default: 90.0 }, // Degrees per second
    spinAxis:  { type: hz.PropTypes.Vec3, default: new hz.Vec3(0, 1, 0) }, // Axis to spin around
    useWorldAxis: { type: hz.PropTypes.Boolean, default: true }, // TRUE = Spin around World Gravity (Top), FALSE = Local Axis
    isPaused: { type: hz.PropTypes.Boolean, default: false },
    
    // Bobbing (Floating) Options
    enableBobbing: { type: hz.PropTypes.Boolean, default: true },
    bobSpeed: { type: hz.PropTypes.Number, default: 2.0 },
    bobHeight: { type: hz.PropTypes.Number, default: 0.1 }, // Meters to move up/down
  };

  private startPos!: hz.Vec3;
  private timeOffset!: number;

  // Runtime state
  private currentSpeed!: number;
  private isPaused!: boolean;
  // PERF FIX: Replaced onPrePhysicsUpdate (60fps per instance) with a 33ms interval (~30fps).
  private updateInterval: number | null = null;
  private static readonly TICK_MS = 33;
  private static readonly TICK_DT = SpinningLogo.TICK_MS / 1000;

  start() {
    this.startPos = this.entity.position.get();
    this.timeOffset = Math.random() * 1000;
    this.currentSpeed = this.props.spinSpeed;
    this.isPaused = this.props.isPaused;

    this.updateInterval = this.async.setInterval(() => this.tick(), SpinningLogo.TICK_MS);
  }

  cleanup(): void {
    if (this.updateInterval !== null) {
      this.async.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private tick(): void {
    if (this.isPaused) return;

    const currentRot = this.entity.rotation.get();
    const spinRot = hz.Quaternion.fromAxisAngle(this.props.spinAxis, this.currentSpeed * SpinningLogo.TICK_DT);

    if (this.props.useWorldAxis) {
      this.entity.rotation.set(spinRot.mul(currentRot));
    } else {
      this.entity.rotation.set(currentRot.mul(spinRot));
    }

    if (this.props.enableBobbing) {
      const time = (Date.now() / 1000) + this.timeOffset;
      const newY = this.startPos.y + Math.sin(time * this.props.bobSpeed) * this.props.bobHeight;
      const currentPos = this.entity.position.get();
      this.entity.position.set(new hz.Vec3(currentPos.x, newY, currentPos.z));
    }
  }

  // --- External Controls ---

  /**
   * Toggles the paused state. 
   * Can be called by other scripts or gizmo events.
   */
  public togglePause() {
    this.isPaused = !this.isPaused;
  }

  public setSpeed(newSpeed: number) {
    this.currentSpeed = newSpeed;
  }
}

hz.Component.register(SpinningLogo);
