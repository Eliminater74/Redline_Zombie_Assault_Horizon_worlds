import * as hz from 'horizon/core';

/**
 * GAME CONFIGURATION
 * Centralizes constants and specific game settings.
 * 
 * GLOBAL RESET SYSTEM:
 * To reset ALL players (offline and online) effectively:
 * 1. We use a "Data Version" number.
 * 2. All storage keys include this version (e.g., "PlayerData:wave_v1").
 * 3. To reset, we simply increment the version (v1 -> v2).
 * 4. Use the derived keys below for all storage/leaderboard operations.
 *
 * NOTE: DATA_VERSION=1 preserves legacy unsuffixed keys for backward compatibility.
 * Version suffixing starts at DATA_VERSION >= 2.
 */

export class GameConfig {
  // INCREMENT THIS MANUALLY OR VIA ADMIN PANEL TO WIPE ALL DATA
  public static readonly DATA_VERSION = 1; 

  // Base Keys
  private static readonly BASE_WAVE_KEY = "PlayerData:wave";
  private static readonly BASE_KILLS_KEY = "PlayerData:kills";
  private static readonly BASE_HEADSHOTS_KEY = "PlayerData:headshots";
  private static readonly BASE_XP_KEY = "PlayerData:levelxp";
  private static readonly BASE_LEVEL_KEY = "PlayerData:plevel";
  private static readonly BASE_AMMO_KEY = "PlayerData:ammo";

  private static withVersion(baseKey: string): string {
    if (this.DATA_VERSION <= 1) return baseKey;
    return `${baseKey}_v${this.DATA_VERSION}`;
  }

  // Dynamic Keys (Getters to ensure they always reflect current version)
  static get WAVE_KEY(): string { 
    return this.withVersion(this.BASE_WAVE_KEY); 
  }

  static get KILLS_KEY(): string { 
    return this.withVersion(this.BASE_KILLS_KEY); 
  }

  static get HEADSHOTS_KEY(): string {
    return this.withVersion(this.BASE_HEADSHOTS_KEY);
  }

  static get XP_KEY(): string {
    return this.withVersion(this.BASE_XP_KEY);
  }

  static get LEVEL_KEY(): string {
    return this.withVersion(this.BASE_LEVEL_KEY);
  }

  static get AMMO_KEY(): string {
    return this.withVersion(this.BASE_AMMO_KEY);
  }

  // Leaderboard Names (Match these in the World Editor!)
  static get LEADERBOARD_WAVE(): string {
    return "HighestWave";
  }

  static get LEADERBOARD_KILLS(): string {
    return "MostKills";
  }

  static get LEADERBOARD_HEADSHOTS(): string {
    return "MostHeadshots";
  }

  static get LEADERBOARD_LEVEL(): string {
    return "ExperienceLevel";
  }

  static get LEADERBOARD_AMMO(): string {
    return "MostAmmo";
  }

  // ========================================================================
  // MODERATION
  // ========================================================================
  // List of player names who have Moderator privileges (Kick, Ban, AFK Exempt)
  // Add new moderators here.
  public static readonly MODERATOR_LIST = [
    "Eliminater74", 
    "EliminatorPK", 
    "bummertownbum",
    "SouthernRebelTX",
    "Crowe.775"
  ];

  static isModerator(playerName: string): boolean {
      if (!playerName) return false;
      return this.MODERATOR_LIST.some(mod => mod.toLowerCase() === playerName.toLowerCase());
  }
}
