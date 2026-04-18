import * as hz from 'horizon/core';
import { Events } from 'Events';
import { AccessControl, EDITORS } from 'AccessControl';
import { GameConfig } from 'GameConfig';
import { PersistenceManager } from 'PersistenceManager';

/**
 * ADMIN PANEL - Mod/Creator Tools
 * Unified script for resetting stats and adding kills/headshots.
 * Only whitelisted users can access these buttons.
 */
class AdminPanel extends hz.Component<typeof AdminPanel> {
  static propsDefinition = {
    // Display text showing what action was triggered
    statusDisplay: { type: hz.PropTypes.Entity },
    
    // Reset triggers (separate buttons)
    resetWaveTrigger: { type: hz.PropTypes.Entity },
    resetKillsTrigger: { type: hz.PropTypes.Entity },
    resetHeadshotsTrigger: { type: hz.PropTypes.Entity },
    
    // GLOBAL RESET (WIPES ALL PLAYERS)
    globalResetTrigger: { type: hz.PropTypes.Entity },

    // Boost triggers (add 1000)
    boostKillsTrigger: { type: hz.PropTypes.Entity },
    boostHeadshotsTrigger: { type: hz.PropTypes.Entity },
  };

  //--------------------------------------------------
  // ACCESS CONTROL - Now uses shared AccessControl module
  //--------------------------------------------------

  // Storage keys (Managed by GameConfig)
  private get KILLS_KEY() { return GameConfig.KILLS_KEY; }
  private get HEADSHOTS_KEY() { return GameConfig.HEADSHOTS_KEY; }
  private get WAVE_KEY() { return GameConfig.WAVE_KEY; }

  start(): void {}

  preStart(): void {
    // Connect all triggers
    this.setupTrigger(this.props.resetWaveTrigger, "RESET WAVE", this.resetWave.bind(this));
    this.setupTrigger(this.props.resetKillsTrigger, "RESET KILLS", this.resetKills.bind(this));
    this.setupTrigger(this.props.resetHeadshotsTrigger, "RESET HEADSHOTS", this.resetHeadshots.bind(this));
    this.setupTrigger(this.props.globalResetTrigger, "GLOBAL RESET (!)", this.globalReset.bind(this));
    this.setupTrigger(this.props.boostKillsTrigger, "ADD 1000 KILLS", this.boostKills.bind(this));
    this.setupTrigger(this.props.boostHeadshotsTrigger, "ADD 1000 HEADSHOTS", this.boostHeadshots.bind(this));
  }

  private setupTrigger(trigger: hz.Entity | undefined, label: string, action: (player: hz.Player) => void) {
    if (!trigger) return;
    
    this.connectCodeBlockEvent(
      trigger,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      (player: hz.Player) => {
        if (!this.hasAccess(player)) {
          this.showStatus(`❌ ACCESS DENIED`);
          return;
        }
        this.showStatus(`✅ ${label}`);
        action(player);
      }
    );
  }

  private hasAccess(player: hz.Player): boolean {
    const isEditor = EDITORS.some(u => u.toLowerCase() === player.name.get().toLowerCase());
    return AccessControl.isAdmin(player) || isEditor;
  }

  private showStatus(msg: string) {
    const display = this.props.statusDisplay?.as(hz.TextGizmo);
    if (display) {
      display.text.set(msg);
      this.async.setTimeout(() => display.text.set(""), 3000);
    }
  }

  //--------------------------------------------------
  // RESET ACTIONS
  //--------------------------------------------------
  private resetWave(player: hz.Player) {
    try {
      const players = this.world.getPlayers();
      const serverId = this.world.getServerPlayer().id;
      let count = 0;
      
      for (const p of players) {
        if (p.id === serverId) continue;
        PersistenceManager.resetWaveOnly(this.world, p);
        count++;
      }
      
      this.showStatus(`✅ Wave reset for ${count} players`);
      console.log(`[AdminPanel] Wave reset for ${count} players by ${player.name.get()}`);
    } catch (e) {
      this.showStatus(`❌ Error resetting wave`);
      console.error(`[AdminPanel] Error resetting wave:`, e);
    }
  }

  private resetKills(player: hz.Player) {
    try {
      PersistenceManager.resetKillsOnly(this.world, player);
      this.sendNetworkBroadcastEvent(Events.updateKillCount, { count: 0, player });
      this.showStatus(`✅ Kills reset for ${player.name.get()}`);
    } catch (e) {
      this.showStatus(`❌ Error resetting kills`);
    }
  }

  private resetHeadshots(player: hz.Player) {
    try {
      PersistenceManager.resetHeadshotsOnly(this.world, player);
      this.showStatus(`✅ Headshots reset for ${player.name.get()}`);
    } catch (e) {
      this.showStatus(`❌ Error resetting headshots`);
    }
  }

  //--------------------------------------------------
  // BOOST ACTIONS (+1000)
  //--------------------------------------------------
  private async boostKills(player: hz.Player) {
    try {
      const current = await this.world.persistentStorage.getPlayerVariable<number>(player, this.KILLS_KEY) ?? 0;
      const newKills = current + 1000;
      
      this.world.persistentStorage.setPlayerVariable(player, this.KILLS_KEY, newKills);
      this.world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_KILLS, player, newKills, true);
      this.sendNetworkBroadcastEvent(Events.updateKillCount, { count: newKills, player });
      
      this.showStatus(`✅ +1000 Kills! Total: ${newKills}`);
    } catch (e) {
      this.showStatus(`❌ Error adding kills`);
    }
  }

  private async boostHeadshots(player: hz.Player) {
    try {
      const current = await this.world.persistentStorage.getPlayerVariable<number>(player, this.HEADSHOTS_KEY) ?? 0;
      const newHS = current + 1000;
      
      this.world.persistentStorage.setPlayerVariable(player, this.HEADSHOTS_KEY, newHS);
      this.world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_HEADSHOTS, player, newHS, true);
      
      this.showStatus(`✅ +1000 Headshots! Total: ${newHS}`);
    } catch (e) {
      this.showStatus(`❌ Error adding headshots`);
    }
  }

  //--------------------------------------------------
  // GLOBAL RESET (Use with Caution!)
  //--------------------------------------------------
  // GLOBAL RESET (Use with Caution!)
  //--------------------------------------------------
  private globalReset(player: hz.Player) {
    // NOTE: Script cannot reset OFFLINE players due to API limitations.
    this.showStatus(`⚠️ ONLY WIPES ONLINE PLAYERS!`);
    console.warn(`[AdminPanel] Global Reset requested. Wiping online players. Manual Editor reset required for offline data.`);
    
    // Wipe online players as a courtesy
    try {
      const players = this.world.getPlayers();
      for (const p of players) {
          PersistenceManager.resetAllStats(this.world, p);
      }
      this.showStatus(`✅ Wiped ${players.length} ONLINE players.`);
    } catch (e) {
      this.showStatus(`❌ Error wiping online players`);
    }
  }
}

hz.Component.register(AdminPanel);
