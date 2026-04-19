import * as hz from 'horizon/core';

/**
 * WelcomeAudio
 * Plays a sound (voice message) when the player joins the world.
 * Attach this to an object and assign your Audio Gizmo.
 */
class WelcomeAudio extends hz.Component<typeof WelcomeAudio> {
  static propsDefinition = {
    audio: { type: hz.PropTypes.Entity }, // The Audio Gizmo
    delay: { type: hz.PropTypes.Number, default: 5.0 }, // Wait for load (VR needs more time)
  };

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store ALL timer handles.
  private pollTimer: number | null = null;
  private playTimer: number | null = null;
  private isDestroyed = false;

  start() {
    // Polling approach: Wait for Local Player to exist, then play.
    this.waitForLocalPlayer();
  }

  // HORIZON BUG WORKAROUND: Cancel both timers so neither fires after component destroy.
  cleanup(): void {
    this.isDestroyed = true;
    if (this.pollTimer !== null) { this.async.clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.playTimer !== null) { this.async.clearTimeout(this.playTimer); this.playTimer = null; }
  }

  private waitForLocalPlayer() {
    if (this.isDestroyed) return;
    const player = this.world.getLocalPlayer();
    if (player) {
      this.playMessage();
      return;
    }
    // Try again in 1 second — store handle so cleanup() can cancel mid-poll
    this.pollTimer = this.async.setTimeout(() => {
      this.pollTimer = null;
      this.waitForLocalPlayer();
    }, 1000);
  }

  private hasPlayed = false;

  private playMessage() {
    if (this.hasPlayed) return;

    if (!this.props.audio) {
      console.warn("[WelcomeAudio] No Audio Gizmo assigned!");
      return;
    }

    const delay = this.props.delay ?? 2.0;
    const audioEntity = this.props.audio;

    // Store handle so cleanup() can cancel if component is destroyed during the delay
    this.playTimer = this.async.setTimeout(() => {
      this.playTimer = null;
      if (this.isDestroyed || this.hasPlayed) return;
      const gizmo = audioEntity.as(hz.AudioGizmo);
      if (gizmo) {
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        gizmo.stop();
        gizmo.play();
        this.hasPlayed = true;
        console.log("[WelcomeAudio] Playing welcome message (Once Only)...");
      }
    }, delay * 1000);
  }
}

hz.Component.register(WelcomeAudio);
