import * as hz from 'horizon/core';
import { GameConfig } from 'GameConfig';
import { Events } from 'Events';

/**
 * PERSISTENCE MANAGER
 * 
 * Central static library for all Persistent Storage and Leaderboard operations.
 * Use this class instead of calling world.persistentStorage directly.
 * 
 * PREVENTS:
 * - Distributed key names (uses GameConfig)
 * - Inconsistent logic (e.g. one script resetting wave but not leaderboard)
 * - Race conditions
 */
export class PersistenceManager {

  // ===========================================================================
  // SAVE OPERATIONS
  // ===========================================================================

  /**
   * Saves the player's highest wave.
   * Updates BOTH Persistent Storage and 'HighestWave' Leaderboard.
   * Only updates if the new wave is higher than previous validation (Leaderboard handles this check automatically for score, but we double check for persistence).
   */
  static saveWave(world: hz.World, player: hz.Player, wave: number) {
    if (!player || !player.isValidReference.get()) return;

    try {
      // 1. Leaderboard (Auto-Max check)
      if (world.leaderboards) {
         world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_WAVE, player, wave, false);
      }

      // 2. Persistent Storage (Manual Max check)
      const currentHigh = world.persistentStorage.getPlayerVariable<number>(player, GameConfig.WAVE_KEY) ?? 0;
      console.log(`[Persistence] Checking Wave for ${player.name.get()}: New=${wave}, OldBest=${currentHigh}`);
      
      if (wave > currentHigh) {
         world.persistentStorage.setPlayerVariable(player, GameConfig.WAVE_KEY, wave);
         console.log(`[Persistence] Saved new Best Wave for ${player.name.get()}: ${wave}`);
      }
    } catch (e) {
      console.error(`[Persistence] Error saving wave for ${player.name.get()}:`, e);
    }
  }

  /**
   * Saves/Updates Kills.
   * Typically called when a player leaves or periodically.
   * NOTE: For live kill counting, we often blindly overwrite with the accurate tracked value from PlayerManager.
   */
  static saveKills(world: hz.World, player: hz.Player, totalKills: number) {
    if (!player || !player.isValidReference.get()) return;

    try {
      // 1. Leaderboard
      if (world.leaderboards) {
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_KILLS, player, totalKills, true);
      }

      // 2. Persistent Storage
      // We assume correct total is passed.
      world.persistentStorage.setPlayerVariable(player, GameConfig.KILLS_KEY, totalKills);
    } catch (e) {
      console.error(`[Persistence] Error saving kills for ${player.name.get()}:`, e);
    }
  }

  /**
   * Saves/Updates Headshots.
   */
  static saveHeadshots(world: hz.World, player: hz.Player, totalHeadshots: number) {
    if (!player || !player.isValidReference.get()) return;

    try {
      if (world.leaderboards) {
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_HEADSHOTS, player, totalHeadshots, true);
      }
      world.persistentStorage.setPlayerVariable(player, GameConfig.HEADSHOTS_KEY, totalHeadshots);
    } catch (e) {
      console.error(`[Persistence] Error saving headshots for ${player.name.get()}:`, e);
    }
  }

  /**
   * Saves/Updates XP and Level.
   */
  static saveXP(world: hz.World, player: hz.Player, xp: number, level: number) {
    if (!player || !player.isValidReference.get()) return;

    try {
       // 1. Leaderboard (Level Sync)
       if (world.leaderboards) {
         world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_LEVEL, player, level, true);
       }

       // 2. Persistent Storage
       world.persistentStorage.setPlayerVariable(player, GameConfig.XP_KEY, xp);
       world.persistentStorage.setPlayerVariable(player, GameConfig.LEVEL_KEY, level);
    } catch (e) {
       console.error(`[Persistence] Error saving XP for ${player.name.get()}:`, e);
    }
  }


  // ===========================================================================
  // RESET OPERATIONS (Admin Tools)
  // ===========================================================================

  /**
   * FULL RESET: Wipes Kills, Headshots, Wave, and XP.
   */
  static resetAllStats(world: hz.World, player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;

    console.log(`[Persistence] !!! FULL RESET for ${player.name.get()} !!!`);

    try {
      // 1. Persistent Storage
      world.persistentStorage.setPlayerVariable(player, GameConfig.WAVE_KEY, 0);
      world.persistentStorage.setPlayerVariable(player, GameConfig.KILLS_KEY, 0);
      world.persistentStorage.setPlayerVariable(player, GameConfig.HEADSHOTS_KEY, 0);
      world.persistentStorage.setPlayerVariable(player, GameConfig.XP_KEY, 0);
      world.persistentStorage.setPlayerVariable(player, GameConfig.LEVEL_KEY, 0);

      // 2. Leaderboards
      if (world.leaderboards) {
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_WAVE, player, 0, true);
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_KILLS, player, 0, true);
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_HEADSHOTS, player, 0, true);
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_LEVEL, player, 0, true);
      }
    } catch (e) {
      console.error(`[Persistence] Error resetting stats for ${player.name.get()}:`, e);
    }
  }

  /**
   * WAVE RESET ONLY: For debugging or seasonal resets.
   */
  static resetWaveOnly(world: hz.World, player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;

    try {
      world.persistentStorage.setPlayerVariable(player, GameConfig.WAVE_KEY, 0);
      if (world.leaderboards) {
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_WAVE, player, 0, true);
      }
      console.log(`[Persistence] Wave reset for ${player.name.get()}`);
    } catch (e) {
      console.error(`[Persistence] Error resetting wave for ${player.name.get()}:`, e);
    }
  }

  static resetKillsOnly(world: hz.World, player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;
    try {
        world.persistentStorage.setPlayerVariable(player, GameConfig.KILLS_KEY, 0);
        if (world.leaderboards) world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_KILLS, player, 0, true);
    } catch(e) {}
  }

  static resetHeadshotsOnly(world: hz.World, player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;
    try {
        world.persistentStorage.setPlayerVariable(player, GameConfig.HEADSHOTS_KEY, 0);
        if (world.leaderboards) world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_HEADSHOTS, player, 0, true);
    } catch(e) {}
  }

  static saveAmmo(world: hz.World, player: hz.Player, totalAmmo: number) {
    if (!player || !player.isValidReference.get()) return;
    try {
      if (world.leaderboards) {
        world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_AMMO, player, totalAmmo, true);
      }
      world.persistentStorage.setPlayerVariable(player, GameConfig.AMMO_KEY, totalAmmo);
    } catch (e) {
      console.error(`[Persistence] Error saving ammo for ${player.name.get()}:`, e);
    }
  }

  static resetAmmoOnly(world: hz.World, player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;
    try {
        world.persistentStorage.setPlayerVariable(player, GameConfig.AMMO_KEY, 0);
        if (world.leaderboards) world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_AMMO, player, 0, true);
    } catch(e) {}
  }
}
