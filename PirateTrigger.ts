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

  preStart(): void {
    this.npc = this.props.npc!.as(Npc);

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterTrigger, (player: hz.Player) => {
      this.onPlayerEntered(player);
    });

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerExitTrigger, (player: hz.Player) => {
      this.onPlayerExited(player);
    });

    this.connectLocalBroadcastEvent(hz.World.onUpdate, data => this.onUpdate(data.deltaTime));

    this.connectNetworkEvent(this.npc!, NpcEvents.OnNpcStoppedSpeaking, () => {
      this.removeTarget();
    });

    this.connectNetworkBroadcastEvent(targetedPlayerEvent, ({player}) => {
      this.setTarget(player!);
    });
  }

  async start() {
    this.npcPlayer = (await this.npc.tryGetPlayer())!;
    this.defaultTargetPosition = this.npcPlayer.head.position.get().add(this.npcPlayer.head.forward.get());
  }

  onUpdate(deltaTime: number) {
    if (this.overrideTarget) {
      this.setTargetPosition();
    }
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
    this.async.setTimeout(() => {
      this.npcPlayer.setLookAtTarget(this.defaultTargetPosition);
    }, 1000);
    this.async.setTimeout(() => {
      this.npcPlayer.clearLookAtTarget();
    }, 2000);
  }

  isNpc(player: hz.Player) {
    // isNPC == true -> NPC; isNPC == false -> player
    return Npc.playerIsNpc(player);
  };

}
hz.Component.register(PirateTrigger);
