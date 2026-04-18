import * as hz from 'horizon/core';
import { Events } from 'Events';
import { GameConfig } from 'GameConfig';
import { PersistenceManager } from 'PersistenceManager';

/**
 * ============================================================================
 * LEVEL MANAGER
 * ============================================================================
 *
 * Tracks player XP and levels. Awards XP for kills, headshots, and wave clears.
 * Levels are calculated using: XP needed for level N = 100 * N^2
 *
 * XP AWARDS:
 * - Kill: 10 XP
 * - Headshot Bonus: +25 XP (on top of kill)
 * - Wave Clear: 50 * wave number
 * - Wave Survival: 5 * wave number (if player survived the wave)
 *
 * SETUP:
 * 1. Attach this script to a Gizmo/Object logic holder.
 * 2. XP and Level are stored persistently per player.
 */
class LevelManager extends hz.Component<typeof LevelManager> {
  static propsDefinition = {};

  // XP Award Values
  private static readonly XP_PER_KILL = 10;
  private static readonly XP_PER_HEADSHOT_BONUS = 25;
  private static readonly XP_PER_WAVE_BASE = 50;      // Multiplied by wave number
  private static readonly XP_PER_SURVIVAL_BASE = 5;   // Multiplied by wave number
  private static readonly XP_PER_VISIT = 100;         // Award for visiting (showWelcome)

  // Persistence Keys (from GameConfig)
  private get XP_KEY(): string { return GameConfig.XP_KEY; }
  private get LEVEL_KEY(): string { return GameConfig.LEVEL_KEY; }

  // Runtime State
  private playerXP = new Map<number, number>();
  private playerLevel = new Map<number, number>();
  private playersInGame = new Set<number>(); // Track who is in the current game

  private isServer(): boolean {
    return this.entity.owner.get().id === this.world.getServerPlayer().id;
  }

  start() {
    if (!this.isServer()) return;

    // Listen for XP-granting events
    this.connectNetworkBroadcastEvent(Events.zombieDeath, this.onZombieDeath.bind(this));
    this.connectLocalBroadcastEvent(Events.playerHeadshot, this.onHeadshot.bind(this));
    this.connectNetworkBroadcastEvent(Events.waveComplete, this.onWaveComplete.bind(this));

    // Track game state for survival bonus
    this.connectNetworkBroadcastEvent(Events.startGame, this.onStartGame.bind(this));
    this.connectNetworkBroadcastEvent(Events.endGame, this.onEndGame.bind(this));

    // Listen for Visit XP (from VisitorLeaderboard)
    this.connectNetworkBroadcastEvent(Events.showWelcome, this.onShowWelcome.bind(this));

    // Load XP when players join
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterWorld, this.onPlayerEnter.bind(this));

    console.log("[LevelManager] Initialized. Tracking XP and Levels.");
  }

  // =========================================================================
  // LEVEL CALCULATION
  // =========================================================================

  /**
   * Calculate level from total XP
   * Level formula: XP needed for level N = 100 * N^2
   * Level 1 = 100 XP, Level 2 = 400 XP total, Level 3 = 900 XP total, etc.
   */
  private calculateLevel(totalXP: number): number {
    // Solve for N: totalXP >= 100 * N^2
    // N = floor(sqrt(totalXP / 100))
    if (totalXP < 100) return 0;
    return Math.floor(Math.sqrt(totalXP / 100));
  }

  /**
   * Calculate total XP needed for a specific level
   */
  private xpForLevel(level: number): number {
    return 100 * level * level;
  }

  /**
   * Get XP progress within current level (0-1)
   */
  private getLevelProgress(totalXP: number): number {
    const currentLevel = this.calculateLevel(totalXP);
    const currentLevelXP = this.xpForLevel(currentLevel);
    const nextLevelXP = this.xpForLevel(currentLevel + 1);
    const progressXP = totalXP - currentLevelXP;
    const neededXP = nextLevelXP - currentLevelXP;
    return neededXP > 0 ? progressXP / neededXP : 0;
  }

  // =========================================================================
  // XP AWARDING
  // =========================================================================

  private awardXP(player: hz.Player, amount: number, reason: string) {
    if (!player) return;

    const pid = player.id;
    const currentXP = this.playerXP.get(pid) ?? 0;
    const oldLevel = this.calculateLevel(currentXP);

    const newXP = currentXP + amount;
    const newLevel = this.calculateLevel(newXP);

    this.playerXP.set(pid, newXP);

    // Save to persistence and leaderboard
    PersistenceManager.saveXP(this.world, player, newXP, newLevel);

    // Send XP gain notification to player
    this.sendNetworkEvent(player, Events.xpGain, {
      amount,
      reason,
      totalXP: newXP,
      level: newLevel,
      progress: this.getLevelProgress(newXP)
    });

    // Check for level up
    if (newLevel > oldLevel) {
      this.playerLevel.set(pid, newLevel);
      console.log(`[LevelManager] ${player.name.get()} leveled up to ${newLevel}!`);

      this.sendNetworkEvent(player, Events.levelUp, {
        oldLevel,
        newLevel,
        totalXP: newXP
      });
    }
  }

  private onShowWelcome(data: { playerId: number, name: string, visits: number }) {
    if (!this.isServer()) return;

    // Award XP for the visit
    const player = this.world.getPlayers().find(p => p.id === data.playerId) ??
      this.world.getPlayers().find(p => p.name.get() === data.name);
    if (player) {
        console.log(`[LevelManager] Awarding Visit XP to ${data.name}`);
        this.awardXP(player, LevelManager.XP_PER_VISIT, "Visit Bonus");
    }
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  private onZombieDeath(data: { zombie: hz.Entity, killer?: hz.Player }) {
    if (!data.killer) return;
    this.awardXP(data.killer, LevelManager.XP_PER_KILL, "Kill");
  }

  private onHeadshot(data: { player: hz.Player }) {
    if (!data.player) return;
    this.awardXP(data.player, LevelManager.XP_PER_HEADSHOT_BONUS, "Headshot");
  }

  private onWaveComplete(data: { wave: number, duration: number }) {
    // Award XP to all players who are alive (survived the wave)
    const serverPlayerId = this.world.getServerPlayer().id;
    const allPlayers = this.world.getPlayers().filter(p => p.id !== serverPlayerId);

    const waveXP = LevelManager.XP_PER_WAVE_BASE * data.wave;
    const survivalXP = LevelManager.XP_PER_SURVIVAL_BASE * data.wave;

    for (const player of allPlayers) {
      // Only award if player was in the game
      if (this.playersInGame.has(player.id)) {
        // Wave completion bonus (everyone in game gets this)
        this.awardXP(player, waveXP, `Wave ${data.wave}`);

        // Survival bonus (TODO: Could check if player is still alive)
        // For now, award to all in-game players
        this.awardXP(player, survivalXP, "Survival");
      }
    }
  }

  private onStartGame() {
    // Track all players in the current game
    this.playersInGame.clear();
    const serverPlayerId = this.world.getServerPlayer().id;
    const allPlayers = this.world.getPlayers().filter(p => p.id !== serverPlayerId);

    for (const player of allPlayers) {
      this.playersInGame.add(player.id);
    }
  }

  private onEndGame() {
    this.playersInGame.clear();
  }

  private onPlayerEnter(player: hz.Player) {
    // Load player's XP from persistent storage
    this.async.setTimeout(async () => {
      try {
        // HORIZON BUG WORKAROUND: getPlayerVariable is synchronous on server; wrap in try/catch for safety.
        const savedXP = this.world.persistentStorage.getPlayerVariable<number>(player, this.XP_KEY);
        const xp = savedXP ?? 0;
        const level = this.calculateLevel(xp);

        this.playerXP.set(player.id, xp);
        this.playerLevel.set(player.id, level);

        console.log(`[LevelManager] Loaded ${player.name.get()}: Level ${level}, XP ${xp}`);

        // Send initial level info to player
        this.sendNetworkEvent(player, Events.levelSync, {
          level,
          totalXP: xp,
          progress: this.getLevelProgress(xp),
          xpToNext: this.xpForLevel(level + 1) - xp
        });

        // Ensure Level Leaderboard is synced
        PersistenceManager.saveXP(this.world, player, xp, level);
      } catch (e) {
        console.warn("[LevelManager] Failed to load XP for player:", e);
        this.playerXP.set(player.id, 0);
        this.playerLevel.set(player.id, 0);
      }
    }, 2000); // Wait for data to be ready
  }

  // =========================================================================
  // PUBLIC GETTERS (For other scripts to query)
  // =========================================================================

  public getPlayerLevel(playerId: number): number {
    return this.playerLevel.get(playerId) ?? 0;
  }

  public getPlayerXP(playerId: number): number {
    return this.playerXP.get(playerId) ?? 0;
  }
}

hz.Component.register(LevelManager);
