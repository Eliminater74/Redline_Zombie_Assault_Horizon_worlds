import * as hz from 'horizon/core';
import { AccessControl } from 'AccessControl';

/**
 * ADMIN PORTAL
 * Teleports players to a target spawn point if they have permission.
 * Can be used for:
 * 1. Entry Trigger (Strict Access) -> Teleport to Admin Room
 * 2. Exit Buttons (Open Access) -> Teleport to Game or Lobby
 */
class AdminPortal extends hz.Component<typeof AdminPortal> {
  static propsDefinition = {
    // TRIGGERS
    entryTrigger: { type: hz.PropTypes.Entity },     // The object players touch to get IN
    exitGameTrigger: { type: hz.PropTypes.Entity },  // Button/Trigger to go back to GAME
    exitLobbyTrigger: { type: hz.PropTypes.Entity }, // Button/Trigger to go back to LOBBY

    // DESTINATIONS
    adminSpawn: { type: hz.PropTypes.Entity },       // Spawn inside Admin Room
    gameSpawn: { type: hz.PropTypes.Entity },        // Spawn in Game Area
    lobbySpawn: { type: hz.PropTypes.Entity },       // Spawn in Lobby Area

    // FEEDBACK
    deniedSFX: { type: hz.PropTypes.Entity },
    grantedSFX: { type: hz.PropTypes.Entity },
    statusText: { type: hz.PropTypes.Entity },
  };

  start() {
     // 1. Entry Logic (Strict)
     if (this.props.entryTrigger) {
         this.connectCodeBlockEvent(
             this.props.entryTrigger,
             hz.CodeBlockEvents.OnPlayerEnterTrigger,
             (player) => this.tryTeleport(player, this.props.adminSpawn, true)
         );
     }

     // 2. Exit to Game (Open)
     if (this.props.exitGameTrigger) {
         this.connectCodeBlockEvent(
             this.props.exitGameTrigger,
             hz.CodeBlockEvents.OnPlayerEnterTrigger,
             (player) => this.tryTeleport(player, this.props.gameSpawn, false)
         );
     }

     // 3. Exit to Lobby (Open)
     if (this.props.exitLobbyTrigger) {
         this.connectCodeBlockEvent(
             this.props.exitLobbyTrigger,
             hz.CodeBlockEvents.OnPlayerEnterTrigger,
             (player) => this.tryTeleport(player, this.props.lobbySpawn, false)
         );
     }
  }

  /**
   * Central teleport logic
   * @param targetSpawn - Where to go
   * @param requireAccess - Whether to check the admin list
   */
  private tryTeleport(player: hz.Player, targetSpawn: hz.Entity | undefined, requireAccess: boolean) {
      // Access Check
      if (requireAccess) {
          if (!AccessControl.hasAccess(player, this.entity)) {
              this.onAccessDenied(player);
              return;
          }
      }

      // Allow
      this.onAccessGranted(player, targetSpawn);
  }

  private onAccessDenied(player: hz.Player) {
      // console.log(`[AdminPortal] Access Denied for ${player.name.get()}`);
      const deniedAudio = this.props.deniedSFX?.as(hz.AudioGizmo);
      if (deniedAudio) {
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        deniedAudio.stop();
        deniedAudio.play();
      }
      this.showStatus("❌ ACCESS DENIED");
  }

  private onAccessGranted(player: hz.Player, targetSpawn: hz.Entity | undefined) {
      // Teleport
      if (targetSpawn) {
          const spawn = targetSpawn.as(hz.SpawnPointGizmo);
          if (spawn) {
              spawn.teleportPlayer(player);
              const grantedAudio = this.props.grantedSFX?.as(hz.AudioGizmo);
              if (grantedAudio) {
                // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
                grantedAudio.stop();
                grantedAudio.play();
              }
              if (this.props.statusText) {
                  this.showStatus("✅ ACCESS GRANTED");
              }
          } else {
              console.error("[AdminPortal] Target Spawn is not a valid SpawnPoint!");
          }
      } else {
          console.warn("[AdminPortal] No target spawn set for this action.");
      }
  }

  private showStatus(msg: string) {
      if (this.props.statusText) {
          const text = this.props.statusText.as(hz.TextGizmo);
          if (text) {
              text.text.set(msg);
              this.async.setTimeout(() => text.text.set(""), 2000);
          }
      }
  }
}

hz.Component.register(AdminPortal);
