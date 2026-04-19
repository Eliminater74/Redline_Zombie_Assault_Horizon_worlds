import * as hz from 'horizon/core';

class LevelTeleport extends hz.Component<typeof LevelTeleport>{  
  static propsDefinition = {
    teleportTo: { type: hz.PropTypes.Entity }, 
    tpSfx: { type: hz.PropTypes.Entity },
  };

  start() {
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
      this.onPlayerEnter(player);
    });
  }

  onPlayerEnter(player: hz.Player) {
    if (this.props.teleportTo) {
      const sound = this.props.tpSfx?.as(hz.AudioGizmo);
      if (sound) {
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        sound.stop();
        sound.play({
          fade: 0,
          players: [player],
        });
      }
      // HORIZON BUG WORKAROUND: Missing null checks on .get()/.as() results — validate before use.
      const checkpoint = this.props.teleportTo.as(hz.SpawnPointGizmo);
      if (checkpoint) {
        checkpoint.teleportPlayer(player);
      }
    }
  }

}

hz.Component.register(LevelTeleport);