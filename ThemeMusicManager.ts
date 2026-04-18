import * as hz from 'horizon/core';
import { Events } from 'Events';

/**
 * ThemeMusicManager
 * Manages background music playlist.
 * - Supports up to 10 theme songs.
 * - Plays songs randomly (no immediate repeats).
 * - Uses "Send Audio Complete" event to chain songs.
 * - Watchdog timer as backup if event is missed.
 */
class ThemeMusicManager extends hz.Component<typeof ThemeMusicManager> {
  static propsDefinition = {
    themeSong1: { type: hz.PropTypes.Entity },
    themeSong2: { type: hz.PropTypes.Entity },
    themeSong3: { type: hz.PropTypes.Entity },
    themeSong4: { type: hz.PropTypes.Entity },
    themeSong5: { type: hz.PropTypes.Entity },
    themeSong6: { type: hz.PropTypes.Entity },
    themeSong7: { type: hz.PropTypes.Entity },
    themeSong8: { type: hz.PropTypes.Entity },
    themeSong9: { type: hz.PropTypes.Entity },
    themeSong10: { type: hz.PropTypes.Entity },
    themeSong11: { type: hz.PropTypes.Entity },
    themeSong12: { type: hz.PropTypes.Entity },
    themeSong13: { type: hz.PropTypes.Entity },
    themeSong14: { type: hz.PropTypes.Entity },
    themeSong15: { type: hz.PropTypes.Entity },
    themeSong16: { type: hz.PropTypes.Entity },
    themeSong17: { type: hz.PropTypes.Entity },
    themeSong18: { type: hz.PropTypes.Entity },
    themeSong19: { type: hz.PropTypes.Entity },
    themeSong20: { type: hz.PropTypes.Entity },
    themeSong21: { type: hz.PropTypes.Entity },
    themeSong22: { type: hz.PropTypes.Entity },
    themeSong23: { type: hz.PropTypes.Entity },
    themeSong24: { type: hz.PropTypes.Entity },
    themeSong25: { type: hz.PropTypes.Entity },
    musicVolume: { type: hz.PropTypes.Number, default: 0.2 },
    maxSongDuration: { type: hz.PropTypes.Number, default: 180 },
  };

  private currentGizmo: hz.AudioGizmo | null = null;
  private currentEntityId: bigint | null = null; // Track by ID for reliable comparison
  private activeSongs: hz.Entity[] = [];
  private isMusicPlaying = false;
  private watchdogTimer: number | null = null;
  private errorRecoveryTimer: number | null = null;
  private listenersConnected = false;

  start() {
    // Build song list
    this.buildSongList();

    // Connect audio completion listeners ONCE (not per game)
    this.connectAudioListeners();

    // Listen for game events
    this.connectNetworkBroadcastEvent(Events.startGame, this.onStartGame.bind(this));
    this.connectNetworkBroadcastEvent(Events.endGame, this.onEndGame.bind(this));
    this.connectNetworkBroadcastEvent(Events.requestForceEnd, this.onEndGame.bind(this));
  }

  private buildSongList() {
    this.activeSongs = [];
    const props = this.props;

    const songs = [
      props.themeSong1, props.themeSong2, props.themeSong3, props.themeSong4, props.themeSong5,
      props.themeSong6, props.themeSong7, props.themeSong8, props.themeSong9, props.themeSong10,
      props.themeSong11, props.themeSong12, props.themeSong13, props.themeSong14, props.themeSong15,
      props.themeSong16, props.themeSong17, props.themeSong18, props.themeSong19, props.themeSong20,
      props.themeSong21, props.themeSong22, props.themeSong23, props.themeSong24, props.themeSong25
    ];

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        if (song && song.id) {
             // Simple Add - relying on runtime catching for bad entities
             this.activeSongs.push(song);
        }
    }

    console.log(`[ThemeMusicManager] Found ${this.activeSongs.length} theme songs`);
  }

  private connectAudioListeners() {
    if (this.listenersConnected) return;
    this.listenersConnected = true;

    for (const entity of this.activeSongs) {
      const entityId = entity.id;

      this.connectCodeBlockEvent(entity, hz.CodeBlockEvents.OnAudioCompleted, () => {
        this.onSongFinished(entityId);
      });
    }
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    this.clearWatchdog();
    if (this.errorRecoveryTimer !== null) {
      this.async.clearTimeout(this.errorRecoveryTimer);
      this.errorRecoveryTimer = null;
    }
    if (this.currentGizmo) {
      try { this.currentGizmo.stop(); } catch (e) { /* ignore */ }
      this.currentGizmo = null;
    }
  }

  private onStartGame() {
    if (this.activeSongs.length === 0) {
      console.warn("[ThemeMusicManager] No theme songs assigned!");
      return;
    }

    this.isMusicPlaying = true;
    this.playRandomSong();
  }

  private onEndGame() {
    this.isMusicPlaying = false;
    this.clearWatchdog();

    if (this.currentGizmo) {
      this.currentGizmo.stop();
      this.currentGizmo = null;
      this.currentEntityId = null;
    }
  }

  private onSongFinished(finishedId: bigint) {
    if (!this.isMusicPlaying) return;
    if (this.currentEntityId === null) return;

    // Only proceed if this is the song we're tracking
    if (this.currentEntityId === finishedId) {
      console.log(`[ThemeMusicManager] Song finished - playing next`);
      this.clearWatchdog();
      this.playRandomSong();
    }
  }

  private playRandomSong() {
    if (!this.isMusicPlaying || this.activeSongs.length === 0) return;

    this.clearWatchdog();

    // Pick random song (avoid immediate repeat)
    let nextEntity: hz.Entity;

    if (this.activeSongs.length > 1 && this.currentEntityId !== null) {
      const others = this.activeSongs.filter(e => e.id !== this.currentEntityId);
      nextEntity = others[Math.floor(Math.random() * others.length)];
    } else {
      nextEntity = this.activeSongs[Math.floor(Math.random() * this.activeSongs.length)];
    }

    // Valid reference check
    if (!nextEntity.isValidReference?.get()) {
         console.warn(`[ThemeMusicManager] ${nextEntity.id} is invalid - removing from playlist`);
         this.activeSongs = this.activeSongs.filter(s => s.id !== nextEntity.id);
         this.playRandomSong();
         return;
    }

    const gizmo = nextEntity.as(hz.AudioGizmo);
    if (!gizmo) {
      console.error(`[ThemeMusicManager] ${nextEntity.name.get()} is not an AudioGizmo`);
      this.activeSongs = this.activeSongs.filter(s => s.id !== nextEntity.id);
      this.playRandomSong();
      return;
    }

    // Stop previous
    if (this.currentGizmo) {
      try {
        this.currentGizmo.stop();
      } catch (e) { /* Ignore stop errors */ }
    }



    // Update tracking
    this.currentEntityId = nextEntity.id;
    this.currentGizmo = gizmo;

    // Play with Error Handling
    try {
        const vol = this.props.musicVolume ?? 0.45;
        console.log(`[ThemeMusicManager] Playing: ${nextEntity.name.get()} (ID: ${nextEntity.id}) at Volume: ${vol}`);
        
        // RESET: Ensure gizmo is fully stopped and ready
        // Check validity right before usage to catch "Ghost Objects"
        if (!gizmo.id) throw new Error("Invalid ID before play");

        gizmo.stop(); 
        gizmo.volume.set(vol);
        gizmo.play();
    } catch (e) {
        console.error(`[ThemeMusicManager] ERROR playing ${nextEntity.name.get()} (ID: ${nextEntity.id}) - Removing from playlist to prevent loop.`, e);
        
        // Auto-heal: Remove this bad ID from the active list
        this.activeSongs = this.activeSongs.filter(s => s.id !== nextEntity.id);
        
        this.currentGizmo = null;
        this.currentEntityId = null;
        
        // BUG FIX: Store handle so cleanup() can cancel if component is destroyed during the 100ms window.
        if (this.errorRecoveryTimer !== null) this.async.clearTimeout(this.errorRecoveryTimer);
        this.errorRecoveryTimer = this.async.setTimeout(() => {
          this.errorRecoveryTimer = null;
          this.playRandomSong();
        }, 100);
        return;
    }

    // Backup watchdog
    this.startWatchdog();
  }

  private startWatchdog() {
    const duration = this.props.maxSongDuration ?? 180;
    this.watchdogTimer = this.async.setTimeout(() => {
      if (!this.isMusicPlaying) return;
      console.warn(`[ThemeMusicManager] Watchdog: ${duration}s timeout - forcing next`);
      this.playRandomSong();
    }, duration * 1000);
  }

  private clearWatchdog() {
    if (this.watchdogTimer !== null) {
      this.async.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

hz.Component.register(ThemeMusicManager);
