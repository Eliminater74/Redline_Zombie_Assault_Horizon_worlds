import * as hz from 'horizon/core';

/**
 * SHARED ACCESS CONTROL
 * Centralized user whitelists for admin/editor/tester access.
 * 
 * USAGE:
 * import { AccessControl } from 'AccessControl';
 * if (AccessControl.hasAccess(player, entity)) { ... }
 */

// --- USER LISTS ---
// Edit these arrays to grant access to specific users

/** Full admin access (can do everything) */
export const ADMINS: string[] = [
  "Eliminater74",
  "EliminatorPK",
];

/** Creators and moderators */
export const MODS: string[] = [
  "saweetlady",
  "Andrew391"
];

/** World editors (can edit but limited powers) */
export const EDITORS: string[] = [
  "bummertownbum",
];

/** Testers (limited access for testing) */
export const TESTERS: string[] = [
  "",
];

// --- ACCESS CHECK FUNCTIONS ---

export const AccessControl = {
  /**
   * Check if a player has any level of access
   */
  hasAccess(player: hz.Player, entity?: hz.Entity): boolean {
    const name = player.name.get();

    // 1. Check if player is the world owner
    if (entity) {
      const owner = entity.owner.get();
      if (owner && player.id === owner.id) return true;
    }

    // 2. Check all access lists (case-insensitive)
    const lowerName = name.toLowerCase();
    
    if (ADMINS.some(u => u.toLowerCase() === lowerName)) return true;
    if (MODS.some(u => u.toLowerCase() === lowerName)) return true;
    if (EDITORS.some(u => u.toLowerCase() === lowerName)) return true;
    if (TESTERS.some(u => u.toLowerCase() === lowerName)) return true;

    return false;
  },

  /**
   * Check if a player is an admin
   */
  isAdmin(player: hz.Player): boolean {
    const name = player.name.get().toLowerCase();
    return ADMINS.some(u => u.toLowerCase() === name);
  },

  /**
   * Check if a player is a mod or higher
   */
  isModOrHigher(player: hz.Player): boolean {
    const name = player.name.get().toLowerCase();
    return ADMINS.some(u => u.toLowerCase() === name) ||
           MODS.some(u => u.toLowerCase() === name);
  },

  /**
   * Check if a player is an editor or higher
   */
  isEditorOrHigher(player: hz.Player): boolean {
    const name = player.name.get().toLowerCase();
    return ADMINS.some(u => u.toLowerCase() === name) ||
           MODS.some(u => u.toLowerCase() === name) ||
           EDITORS.some(u => u.toLowerCase() === name);
  },
};
