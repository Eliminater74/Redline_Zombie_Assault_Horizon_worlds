import * as hz from 'horizon/core';
import { Events } from 'Events';
import { alivePlayers } from 'GameState';

/**
 * AMBIENT HORROR SFX
 * Plays random spooky sounds near players during gameplay.
 * Sounds play at random player positions for immersion!
 */
class AmbientHorrorSFX extends hz.Component<typeof AmbientHorrorSFX> {
  static propsDefinition = {
    // 20 audio gizmos for random spooky sounds
    // Just attach them here - they'll teleport to players when playing
    sfx1: { type: hz.PropTypes.Entity },
    sfx2: { type: hz.PropTypes.Entity },
    sfx3: { type: hz.PropTypes.Entity },
    sfx4: { type: hz.PropTypes.Entity },
    sfx5: { type: hz.PropTypes.Entity },
    sfx6: { type: hz.PropTypes.Entity },
    sfx7: { type: hz.PropTypes.Entity },
    sfx8: { type: hz.PropTypes.Entity },
    sfx9: { type: hz.PropTypes.Entity },
    sfx10: { type: hz.PropTypes.Entity },
    sfx11: { type: hz.PropTypes.Entity },
    sfx12: { type: hz.PropTypes.Entity },
    sfx13: { type: hz.PropTypes.Entity },
    sfx14: { type: hz.PropTypes.Entity },
    sfx15: { type: hz.PropTypes.Entity },
    sfx16: { type: hz.PropTypes.Entity },
    sfx17: { type: hz.PropTypes.Entity },
    sfx18: { type: hz.PropTypes.Entity },
    sfx19: { type: hz.PropTypes.Entity },
    sfx20: { type: hz.PropTypes.Entity },
    
    // Timing (in seconds)
    minDelay: { type: hz.PropTypes.Number, default: 30 },
    maxDelay: { type: hz.PropTypes.Number, default: 90 },

    /** Master Volume (0.0 to 1.0) applied to all SFX */
    volume: { type: hz.PropTypes.Number, default: 1.0 },
  };

  private sfxList: hz.Entity[] = [];
  private isPlaying: boolean = false;
  private nextSFXTimer: number | null = null;

  start(): void {}

  preStart(): void {
    // Build list of available SFX
    if (this.props.sfx1) this.sfxList.push(this.props.sfx1);
    if (this.props.sfx2) this.sfxList.push(this.props.sfx2);
    if (this.props.sfx3) this.sfxList.push(this.props.sfx3);
    if (this.props.sfx4) this.sfxList.push(this.props.sfx4);
    if (this.props.sfx5) this.sfxList.push(this.props.sfx5);
    if (this.props.sfx6) this.sfxList.push(this.props.sfx6);
    if (this.props.sfx7) this.sfxList.push(this.props.sfx7);
    if (this.props.sfx8) this.sfxList.push(this.props.sfx8);
    if (this.props.sfx9) this.sfxList.push(this.props.sfx9);
    if (this.props.sfx10) this.sfxList.push(this.props.sfx10);
    if (this.props.sfx11) this.sfxList.push(this.props.sfx11);
    if (this.props.sfx12) this.sfxList.push(this.props.sfx12);
    if (this.props.sfx13) this.sfxList.push(this.props.sfx13);
    if (this.props.sfx14) this.sfxList.push(this.props.sfx14);
    if (this.props.sfx15) this.sfxList.push(this.props.sfx15);
    if (this.props.sfx16) this.sfxList.push(this.props.sfx16);
    if (this.props.sfx17) this.sfxList.push(this.props.sfx17);
    if (this.props.sfx18) this.sfxList.push(this.props.sfx18);
    if (this.props.sfx19) this.sfxList.push(this.props.sfx19);
    if (this.props.sfx20) this.sfxList.push(this.props.sfx20);

    // Listen for game start/end
    this.connectNetworkBroadcastEvent(Events.startGame, this.onGameStart.bind(this));
    this.connectNetworkBroadcastEvent(Events.endGame, this.onGameEnd.bind(this));
  }

  private onGameStart() {
    if (this.sfxList.length === 0) return;
    this.isPlaying = true;
    this.scheduleNextSound();
  }

  private onGameEnd() {
    this.isPlaying = false;
    if (this.nextSFXTimer !== null) {
      this.async.clearTimeout(this.nextSFXTimer);
      this.nextSFXTimer = null;
    }
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.nextSFXTimer !== null) {
      this.async.clearTimeout(this.nextSFXTimer);
      this.nextSFXTimer = null;
    }
  }

  private scheduleNextSound() {
    if (!this.isPlaying) return;
    
    const minMs = (this.props.minDelay ?? 30) * 1000;
    const maxMs = (this.props.maxDelay ?? 90) * 1000;
    const delay = minMs + Math.random() * (maxMs - minMs);
    
    this.nextSFXTimer = this.async.setTimeout(() => {
      this.playRandomSound();
      this.scheduleNextSound();
    }, delay);
  }

  private playRandomSound() {
    if (this.sfxList.length === 0 || alivePlayers.length === 0) return;

    // Pick random sound and random player
    const sfx = this.sfxList[Math.floor(Math.random() * this.sfxList.length)];
    const player = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

    // FIX: Validate AudioGizmo before manipulating to prevent static entity errors
    const audio = sfx.as(hz.AudioGizmo);
    if (!audio) return; // Not a valid AudioGizmo - skip to prevent errors

    // Move sound to player's position (slightly offset for effect)
    const playerPos = player.position.get();
    const offset = new hz.Vec3(
      (Math.random() - 0.5) * 10,  // Random X offset (-5 to 5)
      0,
      (Math.random() - 0.5) * 10   // Random Z offset (-5 to 5)
    );

    try {
      sfx.position.set(playerPos.add(offset));

      // APPLY GLOBAL VOLUME
      audio.volume.set(this.props.volume);

      // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
      audio.stop();
      audio.play();
    } catch (e) { /* Ignore static entity errors */ }
  }
}

hz.Component.register(AmbientHorrorSFX);
