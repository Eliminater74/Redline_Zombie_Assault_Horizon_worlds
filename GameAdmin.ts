import * as hz from 'horizon/core';
import { Events } from 'Events';
import { AccessControl } from 'AccessControl';

/**
 * GAME ADMIN
 * Consolidated script for all administrative triggers and game state controls.
 * Replaces ResetStation.ts and EndGameButton.ts.
 * 
 * FEATURES:
 * - Reset Station (10s Hold) -> Resets Game
 * - Force End Game (Trigger) -> Ends Game for Everyone
 * - Player Quit (Trigger) -> Removes Player from Game (to Lobby)
 * - Reset Wave (Trigger) -> Restarts current wave
 * - Skip Wave (Trigger) -> Skips to next wave
 * - Dynamic Status Display
 */
class GameAdmin extends hz.Component<typeof GameAdmin> {
  static propsDefinition = {
    // --- DISPLAY ---
    statusDisplay: { type: hz.PropTypes.Entity }, // Text gizmo for feedback

    // --- TRIGGERS ---
    resetGameTrigger: { type: hz.PropTypes.Entity }, // 10s Hold to Reset
    extraResetTrigger: { type: hz.PropTypes.Entity }, // Optional second reset trigger

    endGameTrigger: { type: hz.PropTypes.Entity },   // Ends game for everyone (Global)
    playerQuitTrigger: { type: hz.PropTypes.Entity }, // Ends game for hitting player (Local)

    resetWaveTrigger: { type: hz.PropTypes.Entity }, // Restarts current wave
    skipWaveTrigger: { type: hz.PropTypes.Entity },  // Skips to next wave
  };

  // State for Timer-based triggers (Reset Station)
  private isHolding = false;
  private holdTime = 0;
  private readonly holdDuration = 10;
  private holdTimer: number | null = null;

  start() { }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.holdTimer !== null) {
      this.async.clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
  }

  preStart() {
    this.setupTriggers();
    
    // Listen for Status Report (for Reset Station display)
    this.connectNetworkBroadcastEvent(Events.statusReport, this.onStatusReport.bind(this));
  }

  private setupTriggers() {
    // 1. GAME RESET (Hold 10s)
    this.setupHoldTrigger(this.props.resetGameTrigger);
    this.setupHoldTrigger(this.props.extraResetTrigger);

    // 2. FORCE END GAME (Global)
    this.setupProtectedTrigger(this.props.endGameTrigger, "ENDING GAME...", (p) => {
        this.sendNetworkBroadcastEvent(Events.requestForceEnd, { playerName: p.name.get() });
    });

    // 3. PLAYER QUIT (Local)
    // Note: PlayerManager also listens for a Quit Trigger, but we handle it here if assigned
    if (this.props.playerQuitTrigger) {
        this.connectCodeBlockEvent(
            this.props.playerQuitTrigger,
            hz.CodeBlockEvents.OnPlayerEnterTrigger,
            (player: hz.Player) => {
                 this.showStatus(`Goodbye ${player.name.get()}!`);
                 this.sendNetworkBroadcastEvent(Events.killPlayer, { player, reason: "Quit Game" });
            }
        );
    }

    // 4. WAVE CONTROLS (Require Access)
    this.setupProtectedTrigger(this.props.resetWaveTrigger, "RESETTING WAVE...", (p) => {
        this.sendNetworkBroadcastEvent(Events.requestWaveReset, {});
    });

    this.setupProtectedTrigger(this.props.skipWaveTrigger, "SKIPPING WAVE...", (p) => {
        this.sendNetworkBroadcastEvent(Events.requestWaveSkip, {});
    });
  }

  // --- TRIGGER HELPERS ---

  private setupInstantTrigger(trigger: hz.Entity | undefined, msg: string, action: (p: hz.Player) => void) {
      if (!trigger) return;
      this.connectCodeBlockEvent(trigger, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
          // console.log(`[GameAdmin] ${player.name.get()} triggered: ${msg}`);
          this.showStatus(msg);
          action(player);
      });
  }

  private setupProtectedTrigger(trigger: hz.Entity | undefined, msg: string, action: (p: hz.Player) => void) {
      if (!trigger) return;
      this.connectCodeBlockEvent(trigger, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
          if (!this.checkAccess(player)) {
              this.showStatus("❌ ACCESS DENIED");
              return;
          }
          // console.log(`[GameAdmin] ${player.name.get()} PRO triggered: ${msg}`);
          this.showStatus(msg);
          action(player);
      });
  }

  private setupHoldTrigger(trigger: hz.Entity | undefined) {
      if (!trigger) return;
      
      this.connectCodeBlockEvent(trigger, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
          if (this.isHolding) return;
          
          // Request status on enter
          this.sendNetworkBroadcastEvent(Events.requestStatus, {});
          
          if (!this.checkAccess(player)) {
              this.showStatus("❌ ACCESS DENIED");
              return;
          }

          this.isHolding = true;
          this.holdTime = 0;
          this.startHoldLoop();
      });

      this.connectCodeBlockEvent(trigger, hz.CodeBlockEvents.OnPlayerExitTrigger, (player: hz.Player) => {
          this.stopHoldLoop();
      });
  }

  private checkAccess(player: hz.Player): boolean {
      return AccessControl.hasAccess(player, this.entity);
  }

  // --- LOGIC ---

  private startHoldLoop() {
      if (this.holdTimer) return;
      
      const text = this.props.statusDisplay?.as(hz.TextGizmo);
      
      this.holdTimer = this.async.setInterval(() => {
          this.holdTime++;
          const remaining = this.holdDuration - this.holdTime;
          
          if (text) text.text.set(`Hold to Reset: ${remaining}s`);
          
          if (this.holdTime >= this.holdDuration) {
              this.triggerGameReset();
          }
      }, 1000);
  }

  private stopHoldLoop() {
      if (this.holdTimer) {
          this.async.clearInterval(this.holdTimer);
          this.holdTimer = null;
      }
      this.isHolding = false;
      this.holdTime = 0;
      this.showStatus(""); // Clear text
  }

  private triggerGameReset() {
      this.stopHoldLoop();
      this.showStatus("🔄 GAME RESETTING...");
      const localPlayer = this.world.getLocalPlayer();
      const playerName = localPlayer?.name.get() ?? "Admin";
      this.sendNetworkBroadcastEvent(Events.requestGameReset, { playerName });
  }

  private showStatus(msg: string) {
      const display = this.props.statusDisplay?.as(hz.TextGizmo);
      if (display) {
          display.text.set(msg);
          // Auto-clear after 3s if not holding
          if (!this.isHolding) {
              this.async.setTimeout(() => display.text.set(""), 3000);
          }
      }
  }

  private onStatusReport(data: { wave: number, zombies: number, total: number, isSpawning: boolean, uptime: number }) {
      if (this.isHolding) return; // Don't overwrite countdown
      const msg = `STATUS:\nWave: ${data.wave}\nZombies: ${data.zombies}/${data.total}\nSpawning: ${data.isSpawning ? "Yes" : "No"}\nUptime: ${data.uptime}s`;
      const display = this.props.statusDisplay?.as(hz.TextGizmo);
      if (display) display.text.set(msg);
  }
}

hz.Component.register(GameAdmin);
