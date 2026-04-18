import * as hz from 'horizon/core';
import { Npc, NpcPlayer, NpcEvents } from 'horizon/npc';

export const targetedPlayerEvent = new hz.NetworkEvent<{player: hz.Player | null}>("targetedPlayerEvent");

class PirateTrigger extends hz.Component<typeof PirateTrigger> {
  static propsDefinition = {
    npc: { type: hz.PropTypes.Entity },
  };

  private npc!: Npc;
  private npcPlayer!: NpcPlayer;
  private targetPlayer!: hz.Player;
  private defaultTargetPosition!: hz.Vec3;
  private greetedPlayers: hz.Player[] = [];
  private overrideTarget: boolean = false;

  // PERF FIX: Replaced World.onUpdate (60 FPS) with 100ms interval — NPC look-at doesn't need frame accuracy.
  private updateInterval: number | null = null;
  // BUG FIX: Track both removeTarget timers so rapid re-calls don't stack duplicate timers.
  private lookAtTimer: number | null = null;
  private clearLookTimer: number | null = null;

  preStart(): void {
    this.npc = this.props.npc!.as(Npc);

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
      this.onPlayerEntered(player);
    });

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerExitTrigger, (player: hz.Player) => {
      this.onPlayerExited(player);
    });

    this.connectNetworkEvent(this.npc!, NpcEvents.OnNpcStoppedSpeaking, () => {
      this.removeTarget();
    });

    this.connectNetworkBroadcastEvent(targetedPlayerEvent, ({player}) => {
      this.setTarget(player!);
    });
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.updateInterval !== null) {
      this.async.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.lookAtTimer !== null) {
      this.async.clearTimeout(this.lookAtTimer);
      this.lookAtTimer = null;
    }
    if (this.clearLookTimer !== null) {
      this.async.clearTimeout(this.clearLookTimer);
      this.clearLookTimer = null;
    }
  }

  async start() {
    this.npcPlayer = (await this.npc.tryGetPlayer())!;
    this.defaultTargetPosition = this.npcPlayer.head.position.get().add(this.npcPlayer.head.forward.get());
    // Start after npcPlayer is ready so the tick can safely access it.
    this.updateInterval = this.async.setInterval(() => {
      if (this.overrideTarget && this.npcPlayer) {
        this.setTargetPosition();
      }
    }, 100);
  }

  setTarget(target:hz.Player) {
    if (target){
      this.targetPlayer = target;
      this.overrideTarget = true;
    } else {
      this.overrideTarget = false;
    }
  }

  setTargetPosition() {
    const targetPos = this.targetPlayer.head.position.get();
    this.npcPlayer.setLookAtTarget(targetPos);
  }

  onPlayerEntered(player: hz.Player) {
    if ((!this.npcPlayer) || (this.isNpc(player))){
      return;
    }
    const playerName = player.name.get();
    this.registerNewPlayer(player);
    if (!this.overrideTarget) {
      if (!this.greetedPlayers.includes(player)){
        this.npc?.conversation.setDynamicContext(`${playerName}`, `${playerName} is new`);
        this.greetedPlayers.push(player);
      } else {
        this.npc?.conversation.setDynamicContext(`${playerName}`, `${playerName} has returned`);
      }
      this.npc?.conversation.elicitResponse(`Greet Player ${playerName}`);
      this.targetPlayer = player;
      this.overrideTarget = true;
    }
  }

  onPlayerExited(player: hz.Player) {
    if ((!this.npcPlayer) || (this.isNpc(player))){
      return;
    }
    this.unregisterNewPlayer(player);
    this.removeTarget();
  }

  registerNewPlayer(player: hz.Player) {
    this.npc?.conversation.registerParticipant(player);
    this.npcPlayer?.addAttentionTarget(player);
  }

  unregisterNewPlayer(player: hz.Player) {
    this.npc?.conversation.unregisterParticipant(player);
    this.npcPlayer?.removeAttentionTarget(player);
  }

  removeTarget() {
    this.overrideTarget = false;
    // Cancel any in-flight timers from a previous removeTarget() call.
    if (this.lookAtTimer !== null) { this.async.clearTimeout(this.lookAtTimer); }
    if (this.clearLookTimer !== null) { this.async.clearTimeout(this.clearLookTimer); }
    this.lookAtTimer = this.async.setTimeout(() => {
      this.lookAtTimer = null;
      this.npcPlayer.setLookAtTarget(this.defaultTargetPosition);
    }, 1000);
    this.clearLookTimer = this.async.setTimeout(() => {
      this.clearLookTimer = null;
      this.npcPlayer.clearLookAtTarget();
    }, 2000);
  }

  isNpc(player: hz.Player) {
    // isNPC == true -> NPC; isNPC == false -> player
    return Npc.playerIsNpc(player);
  };

}
hz.Component.register(PirateTrigger);
