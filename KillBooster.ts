import * as hz from 'horizon/core';
import { Events } from 'Events';
import { GameConfig } from 'GameConfig';

/**
 * KILL BOOSTER TRIGGER
 * Attach to a trigger volume. When a player enters, they receive bonus kills.
 * Useful for admin/testing purposes or to restore lost kill counts.
 * 
 * DELETE THIS SCRIPT AFTER USE to prevent abuse!
 */
class KillBooster extends hz.Component<typeof KillBooster> {
  static propsDefinition = {
    killsToAdd: { type: hz.PropTypes.Number, default: 1000 },
    oneTimeUse: { type: hz.PropTypes.Boolean, default: true },
  };

  private usedPlayers = new Set<number>(); // Track who already used it
  private readonly KILLS_KEY = GameConfig.KILLS_KEY;

  start() {
    this.connectCodeBlockEvent(
      this.entity, 
      hz.CodeBlockEvents.OnPlayerEnterTrigger, 
      this.onPlayerEnter.bind(this)
    );
  }

  private async onPlayerEnter(player: hz.Player) {
    // Only run on server
    if (this.entity.owner.get().id !== this.world.getServerPlayer().id) return;

    // One-time use check
    if (this.props.oneTimeUse && this.usedPlayers.has(player.id)) {
      console.log(`[KillBooster] ${player.name.get()} already used this booster.`);
      return;
    }

    try {
      // Get current kills from persistent storage
      const result = await this.world.persistentStorage.getPlayerVariable(player, this.KILLS_KEY);
      const currentKills: number = (result ?? 0) as number;
      const newKills = currentKills + this.props.killsToAdd;

      // Update persistent storage
      this.world.persistentStorage.setPlayerVariable(player, this.KILLS_KEY, newKills);

      // Mark as used only after save succeeds — prevents locking player out if save fails
      this.usedPlayers.add(player.id);

      // Update leaderboard
      this.world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_KILLS, player, newKills, true);

      // Update HUD
      this.sendNetworkBroadcastEvent(Events.updateKillCount, { 
        count: newKills, 
        player: player 
      });

      console.log(`[KillBooster] Gave ${this.props.killsToAdd} kills to ${player.name.get()}. New total: ${newKills}`);
    } catch (e: unknown) {
      console.error("[KillBooster] Error:", e);
    }
  }
}

hz.Component.register(KillBooster);
