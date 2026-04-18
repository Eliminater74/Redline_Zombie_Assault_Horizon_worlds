import { CodeBlockEvents, Component, Entity, Player, PropTypes, Quaternion, Space, Vec3, World } from 'horizon/core';
import { Npc, NpcPlayer,NpcEvents,NpcEngagementPhase } from 'horizon/npc';
import { targetedPlayerEvent } from './PirateTrigger';

class TreasureTrigger extends Component<typeof TreasureTrigger>{
  static propsDefinition = {
    chestLid: {type: PropTypes.Entity},
    npc: {type: PropTypes.Entity},
  };

  private chestLid: Entity | undefined;
  private triggered: boolean = false;
  private opened: boolean = false;
  private elapsedTime: number = 0;
  private delayTime: number = 4;
  private npc!: Npc;
  private npcPlayer!: NpcPlayer;
  private currentPhase?: NpcEngagementPhase;

  preStart() {
    this.npc = this.props.npc!.as(Npc);
    this.connectCodeBlockEvent(this.entity, CodeBlockEvents.OnPlayerEnterTrigger, this.OnPlayerEnterTrigger.bind(this));
    this.connectLocalBroadcastEvent(World.onUpdate, (data: { deltaTime: number }) => this.onUpdate(data.deltaTime));
  }

  async start() {
    this.npcPlayer = (await this.npc.tryGetPlayer())!;
    this.chestLid = this.props.chestLid;
  }

  onUpdate(deltaTime: number) {
    if (this.triggered && !this.opened) {
      this.elapsedTime += deltaTime;
      this.animateLid(0, -90, 0.5, true, 1);
    }
    if (this.opened) {
      this.elapsedTime += deltaTime;
      if (this.elapsedTime > this.delayTime) {
        this.animateLid(-90, 0, 0.5, false, this.delayTime);
      }
    }
  }


  animateLid(startAngle: number, targetAngle: number, duration: number, openedState: boolean, delayTime: number) {
    const t = Math.min(this.elapsedTime%delayTime/duration, 1);
    const rotation = Quaternion.slerp(Quaternion.fromEuler(new Vec3(startAngle, 0, 0)), Quaternion.fromEuler(new Vec3(targetAngle, 0, 0)), t);
    this.chestLid!.rotateRelativeTo(this.chestLid!.parent.get()!, rotation, Space.Local);

    if (t === 1) {
      this.triggered = false;
      this.elapsedTime = 0;
      this.opened = openedState;
      this.onLidClose();
    }
  }


  async OnPlayerEnterTrigger(player: Player) {
    this.triggered = true;
    const playerName = player.name.get();
    this.sendNetworkBroadcastEvent(targetedPlayerEvent, {player: player});
    await this.npc.conversation.addEventPerception(`${playerName} opened your treasure chest`);
    await this.npc.conversation.setDynamicContext("treasure_status", `${playerName} is looking at your teasure chest`);
    await this.npc.conversation.elicitResponse(`with anger, accuse ${playerName} of wanting to steal your treasure`);
    this.sendNetworkBroadcastEvent(targetedPlayerEvent, {player: null});
  }


  onLidClose() {
    this.npc.conversation.addEventPerception("You closed the treasure chest");
    this.npc.conversation.setDynamicContext("treasure_status", "The treasure is safe");
  }


}
Component.register(TreasureTrigger);
