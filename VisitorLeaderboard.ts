import {
  Component,
  Player,
  CodeBlockEvents,
} from "horizon/core";
import { Events } from 'Events';

/**
 * VISITOR LEADERBOARD SCRIPT (Fixed)
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a Leaderboard in World Settings named "Visits".
 * 2. Create a Persistent Player Variable named "PlayerData:visits" (Type: Number).
 * 3. Legacy migration: if "PlayerData:xp" exists, it is used once as a fallback.
 */
export class VisitorLeaderboard extends Component<typeof VisitorLeaderboard> {
  static propsDefinition = {
    // Optional: Link a text gizmo to visualize it, or just leave it for the leaderboard
  };

  // CONFIGURATION
  private readonly VAR_KEY = "PlayerData:visits";
  private readonly LEGACY_VAR_KEY = "PlayerData:xp";
  private readonly LEADERBOARD_NAME = "Visits";

  // CACHE
  // Use static to share state across multiple instances of this script
  private static processedPlayers = new Set<number>();

  start() {
    this.connectCodeBlockEvent(
      this.entity,
      CodeBlockEvents.OnPlayerEnterWorld,
      this.onPlayerEnter.bind(this)
    );

    this.connectCodeBlockEvent(
      this.entity,
      CodeBlockEvents.OnPlayerExitWorld,
      this.onPlayerExit.bind(this)
    );
  }

  private isServer(): boolean {
    return this.world.getServerPlayer().id === this.entity.owner.get().id;
  }

  private onPlayerEnter(player: Player) {
    // 1. Server Authority Check
    if (!this.isServer()) return;
    
    // IDEMPOTENCY CHECK
    if (VisitorLeaderboard.processedPlayers.has(player.id)) return;
    VisitorLeaderboard.processedPlayers.add(player.id);

    // Wait for data to load
    this.async.setTimeout(() => {
        this.processVisit(player);
    }, 2000);
  }

  private onPlayerExit(player: Player) {
    VisitorLeaderboard.processedPlayers.delete(player.id);
  }

  private processVisit(player: Player) {
    // 2. VALIDITY CHECK - Critical for preventing "Object reference invalid" errors
    if (!player || !player.isValidReference.get()) {
        console.warn("[VisitorScript] Player left before data could be saved.");
        if (player) {
          VisitorLeaderboard.processedPlayers.delete(player.id);
        }
        return;
    }

    try {
        // --- READ ---
        // Note: If "Visits" variable doesn't exist in World Settings, this throws an error.
        let currentVisits = this.world.persistentStorage.getPlayerVariable<number>(player, this.VAR_KEY);
        if (currentVisits === undefined || currentVisits === null) {
          const legacyVisits = this.world.persistentStorage.getPlayerVariable<number>(player, this.LEGACY_VAR_KEY);
          if (legacyVisits !== undefined && legacyVisits !== null) {
            currentVisits = legacyVisits;
          }
        }
        
        // --- INCREMENT ---
        const newVisits = Number(currentVisits ?? 0) + 1;

        // --- SAVE ---
        this.world.persistentStorage.setPlayerVariable(player, this.VAR_KEY, newVisits);
        console.log(`[VisitorScript] ${player.name.get()} visited ${newVisits} times.`);

        // --- LEADERBOARD ---
        if (this.world.leaderboards) {
             this.world.leaderboards.setScoreForPlayer(this.LEADERBOARD_NAME, player, newVisits, true);
        }

        // --- WELCOME EVENT ---
        this.sendNetworkBroadcastEvent(Events.showWelcome, {
          playerId: player.id,
          name: player.name.get(),
          visits: newVisits,
        });

    } catch (e: any) {
        // Clean error logging
        if (e.message && e.message.includes("Variable not found")) {
             console.error(`[VisitorScript] SETUP ERROR: Player Variable '${this.VAR_KEY}' is missing in World Settings!`);
        } else if (e.message && e.message.includes("Leaderboard not found")) {
             console.error(`[VisitorScript] SETUP ERROR: Leaderboard '${this.LEADERBOARD_NAME}' is missing in World Settings!`);
        } else {
             console.error("[VisitorScript] generic error:", e);
        }
    }
  }
}

Component.register(VisitorLeaderboard);
