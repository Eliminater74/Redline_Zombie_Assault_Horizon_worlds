import * as hz from 'horizon/core';
import { Npc, NpcPlayer,NpcEvents,NpcEngagementPhase } from 'horizon/npc';
import { targetedPlayerEvent } from './PirateTrigger';

class HatTrigger extends hz.Component<typeof HatTrigger> {
  static propsDefinition = {
    npc: { type: hz.PropTypes.Entity },
  };

  private npc!: Npc;
  private npcPlayer!: NpcPlayer;
  private currentPhase?: NpcEngagementPhase;

  preStart(): void {
    this.npc = this.props.npc!.as(Npc);

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnGrabStart, (isRightHand: boolean, player: hz.Player) => this.onGrabStart(player));
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnGrabEnd, (player: hz.Player) => this.onGrabEnd(player));
    this.connectNetworkEvent(this.npc!, NpcEvents.OnNpcEngagementChanged, (data) => {
      this.currentPhase = data.phase;
    });
  }

  async start() {
    this.npcPlayer = (await this.npc.tryGetPlayer())!;
  }

  async onGrabStart(player: hz.Player) {
    const playerName = player.name.get();
    this.sendNetworkBroadcastEvent(targetedPlayerEvent, {player: player});

    await this.npc.conversation.addEventPerception(`${playerName} Picked up the pirate hat`);
    await this.npc.conversation.setDynamicContext(`${playerName}_achievement`, `${playerName} is holding the pirate hat`);
    await this.npc.conversation.elicitResponse(`with excitement, ask if ${playerName} want to being your crew`);
    this.sendNetworkBroadcastEvent(targetedPlayerEvent, {player: null});

  }

  onGrabEnd(player: hz.Player) {
    const playerName = player.name.get();
    this.npc.conversation.addEventPerception(`${playerName} Dropped the pirate hat`);
    this.npc.conversation.setDynamicContext(`${playerName}_achievement`, `${playerName} Dropped the pirate hat`);
    //this.sendNetworkBroadcastEvent(targetedPlayerEvent, {player: null});
  }

}
hz.Component.register(HatTrigger);
