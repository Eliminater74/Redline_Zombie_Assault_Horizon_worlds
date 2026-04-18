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

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — track destroyed state.
  private isDestroyed = false;

  start() {
    // Polling approach: Wait for Local Player to exist, then play.
    // This avoids Type Errors with events and handles VR loading delays.
    this.waitForLocalPlayer();
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel polling in cleanup().
  cleanup(): void {
    this.isDestroyed = true;
  }

  private waitForLocalPlayer() {
    // Check if player exists yet
    if (this.isDestroyed) return;
    const player = this.world.getLocalPlayer();
    if (player) {
         this.playMessage();
         return;
    }

    // Try again in 1 second
    this.async.setTimeout(() => this.waitForLocalPlayer(), 1000);
  }

  private hasPlayed = false;

  private playMessage() {
    if (this.hasPlayed) return; // Enforce play-once per session
    
    if (!this.props.audio) {
        console.warn("[WelcomeAudio] No Audio Gizmo assigned!");
        return;
    }

    const delay = this.props.delay ?? 2.0;
    const audioEntity = this.props.audio;

    // Wait a moment for world to settle
    this.async.setTimeout(() => {
        if (!audioEntity) return; 

        // Check again to be safe
        if (this.hasPlayed) return;

        const gizmo = audioEntity.as(hz.AudioGizmo);
        if (gizmo) {
            // FIX: Using play() directly.
            // RECOMMENDATION: Set this Audio Gizmo to '2D' (Global) in the Editor
            // so it plays clearly for the player regardless of spawn position.
            // Moving the entity caused conflicts in multiplayer.
            
            gizmo.stop();
            gizmo.play(); 
            this.hasPlayed = true;
            console.log("[WelcomeAudio] Playing welcome message (Once Only)...");
        }
    }, delay * 1000);
  }
}

hz.Component.register(WelcomeAudio);
