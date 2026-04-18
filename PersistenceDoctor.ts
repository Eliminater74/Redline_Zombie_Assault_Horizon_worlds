import * as hz from "horizon/core";
import { Component, Player, CodeBlockEvents } from "horizon/core";

/**
 * PERSISTENCE DOCTOR
 * Diagnoses and logs all persistent variable values for a player.
 * Attach to any entity and assign a trigger - when a player enters, it will check all keys.
 */
class PersistenceDoctor extends Component<typeof PersistenceDoctor> {
  static propsDefinition = {
    trigger: { type: hz.PropTypes.Entity },
  };

  // All the keys to check (both prefixed and simple formats)
  private readonly KEYS_TO_CHECK = [
    "PlayerData:kills",
    "PlayerData:headshots",
    "PlayerData:wave",
    "PlayerData:xp",      
    "PlayerData:levelxp",
    "PlayerData:plevel",
    "kills",
    "headshots",
    "wave",
    "xp",
    "levelxp",
    "plevel",
  ];

  override start() {
    if (!this.props.trigger) {
      console.error("[PersistenceDoctor] No trigger assigned! Assign one in the props.");
      return;
    }
    
    // When a player enters the assigned trigger, run the diagnosis.
    this.connectCodeBlockEvent(
      this.props.trigger,
      CodeBlockEvents.OnPlayerEnterTrigger,
      (player: Player) => this.runDiagnosis(player)
    );
    
    console.log("[PersistenceDoctor] Ready - step into trigger to diagnose");
  }

  private runDiagnosis(player: Player) {
    const playerName = player.name.get();
    const storage = this.world.persistentStorage;
    
    console.log("=".repeat(60));
    console.log(`[DOCTOR] Checking ALL persistence for: ${playerName}`);
    console.log("=".repeat(60));
    
    for (const key of this.KEYS_TO_CHECK) {
      try {
        const value = storage.getPlayerVariable<number>(player, key);
        if (value !== undefined && value !== null && value !== 0) {
          console.log(`  ✅ ${key} = ${value}`);
        } else {
          console.log(`  ❌ ${key} = ${value ?? 'undefined'}`);
        }
      } catch (e) {
        console.log(`  ⚠️ ${key} = ERROR (key may not exist in world)`);
      }
    }
    
    console.log("=".repeat(60));
    console.log("[DOCTOR] Diagnosis complete. Check which keys have your data!");
    console.log("[DOCTOR] If data is under simple keys (kills, wave) but not");
    console.log("[DOCTOR] prefixed keys (PlayerData:kills), migration is needed.");
    console.log("=".repeat(60));
  }
}

Component.register(PersistenceDoctor);