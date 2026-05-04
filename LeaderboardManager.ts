import * as hz from 'horizon/core';
import { Events } from 'Events';

/**
 * ============================================================================
 * LEADERBOARD MANAGER
 * ============================================================================
 * 
 * Central hub for writing to Horizon Leaderboards.
 * Prevents logic duplication and "blank board" issues by handling all writes here.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Attach this script to a Gizmo/Object logic holder.
 * 2. Type the EXACT names of your leaderboards in the script properties.
 * 3. (Optional) Drag your Leaderboard Gizmos into the slots if needed for reference,
 *    but the String Name is the most critical part.
 */
class LeaderboardManager extends hz.Component<typeof LeaderboardManager> {
  static propsDefinition = {
    /** Name of the Wave Leaderboard (e.g. "HighestWave") */
    waveLeaderboardName: { type: hz.PropTypes.String, default: "HighestWave" },
    
    /** Name of the Kills Leaderboard (e.g. "MostKills") */
    killsLeaderboardName: { type: hz.PropTypes.String, default: "MostKills" },
    
    /** Name of the Headshots Leaderboard (e.g. "MostHeadshots") */
    headshotsLeaderboardName: { type: hz.PropTypes.String, default: "MostHeadshots" },

    /** Name of the Level Leaderboard (e.g. "ExperienceLevel") */
    levelLeaderboardName: { type: hz.PropTypes.String, default: "ExperienceLevel" },

    /** Name of the Ammo Leaderboard (e.g. "MostAmmo") */
    ammoLeaderboardName: { type: hz.PropTypes.String, default: "MostAmmo" },

    /** Optional Reference to Wave Visual Gizmo */
    waveGizmo: { type: hz.PropTypes.Entity },
    /** Optional Reference to Kills Visual Gizmo */
    killsGizmo: { type: hz.PropTypes.Entity },
    /** Optional Reference to Headshots Visual Gizmo */
    headshotsGizmo: { type: hz.PropTypes.Entity },
  };

  start() {
    this.connectLocalBroadcastEvent(Events.updateLeaderboard, this.onUpdateLeaderboard.bind(this));
    console.log(`[LeaderboardManager] Initialized. Listening for updates...`);
    console.log(`[LeaderboardManager] Configured Boards: Wave='${this.props.waveLeaderboardName}', Kills='${this.props.killsLeaderboardName}', Headshots='${this.props.headshotsLeaderboardName}', Level='${this.props.levelLeaderboardName}'`);
  }

  onUpdateLeaderboard(data: { player: hz.Player, stat: 'kills' | 'headshots' | 'wave' | 'level', value: number }) {
      if (!this.world.leaderboards) {
          console.error("[LeaderboardManager] CRITICAL: Leaderboard API unavailable!");
          return;
      }

      let boardName = "";
      // Default: Update only if higher (Best Score). 
      // EXCEPT for cumulative stats? No, setScoreForPlayer is usually "Best Score".
      // Horizon Leaderboards usually track "Best". 
      // If we want cumulative, we handle that in PlayerManager (counting kills) and just report the NEW TOTAL here.
      // So 'force' is usually true if we are reporting a new total that we know is higher.
      
      let forceUpdate = true; // Since we track totals externally, we just overwrite with the new total.

      switch (data.stat) {
          case 'kills':
              boardName = this.props.killsLeaderboardName;
              break;
          case 'headshots':
              boardName = this.props.headshotsLeaderboardName;
              break;
          case 'level':
              boardName = this.props.levelLeaderboardName;
              break;
          case 'ammo':
              boardName = this.props.ammoLeaderboardName;
              break;
          case 'wave':
              boardName = this.props.waveLeaderboardName;
              forceUpdate = false; // For waves, only update if higher (though PlayerManager usually checks too)
              break;
      }

      if (!boardName) {
          console.warn(`[LeaderboardManager] No leaderboard name configured for stat '${data.stat}'`);
          return;
      }

      // console.log(`[LeaderboardManager] Updating '${boardName}' for ${data.player.name.get()} -> ${data.value}`);

      try {
          this.world.leaderboards.setScoreForPlayer(boardName, data.player, data.value, forceUpdate);
      } catch (e) {
          console.error(`[LeaderboardManager] Failed to write to '${boardName}':`, e);
      }
  }
}

hz.Component.register(LeaderboardManager);
