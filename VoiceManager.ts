import * as hz from 'horizon/core';

/**
 * VoiceManager
 * Enforces "Global" voice chat for all players to ensure everyone can be heard.
 * Attaches to a central logic object (e.g., GameLogic).
 */
class VoiceManager extends hz.Component<typeof VoiceManager> {
  static propsDefinition = {
      mode: { type: hz.PropTypes.String, default: "Global" } // Options: Global, Extended, Nearby, Default
  };

  private voiceInterval: number | null = null;

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.voiceInterval !== null) {
      this.async.clearInterval(this.voiceInterval);
      this.voiceInterval = null;
    }
  }

  start() {
    // 1. Set for all current players (in case of script reload)
    const players = this.world.getPlayers();
    players.forEach(p => this.enforceVoice(p));

    // 2. Set for new players joining
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterWorld,
      (player) => {
          this.enforceVoice(player);
          // RETRY: Try again after 2 seconds to ensure it sticks
          this.async.setTimeout(() => this.enforceVoice(player), 2000);
      }
    );

    // 3. PERIODIC CHECK: Every 10 seconds, force everyone to Global
    this.voiceInterval = this.async.setInterval(() => {
        const currentPlayers = this.world.getPlayers();
        currentPlayers.forEach(p => this.enforceVoice(p));
    }, 10000);
  }

  private enforceVoice(player: hz.Player) {
    if (player) {
      // console.log(`[VoiceManager] Setting Voice to ${this.props.mode} for ${player.name.get()}`);

      // Cast string prop to VoipSetting type
      player.setVoipSetting(this.props.mode as hz.VoipSetting);
    }
  }
}

hz.Component.register(VoiceManager);
