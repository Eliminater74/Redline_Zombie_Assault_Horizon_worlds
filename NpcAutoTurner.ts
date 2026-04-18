import * as hz from 'horizon/core';
//import { ExperimentalCodeBlockEvents, NPCEngagementPhase, NPCGizmo } from "horizon/genai_conversation";
//import {AvatarAIAgent} from 'horizon/avatar_ai_agent';
//import * as exp from 'horizon/experimental';
import {NpcEvents, Npc, NpcPlayer, NpcEngagementPhase} from 'horizon/npc';

class npcAutoTurner extends hz.Component<typeof npcAutoTurner> {
  static propsDefinition = {
    npc: { type: hz.PropTypes.Entity, default: undefined },
    idlingHardThresholdAngle: { type: hz.PropTypes.Number, default: 135 },
    idlingSoftThresholdAngle: { type: hz.PropTypes.Number, default: 90 },
    idlingSoftThresholdTime: { type: hz.PropTypes.Number, default: 4 },
    targetingHardThresholdAngle: { type: hz.PropTypes.Number, default: 60 },
    targetingSoftThresholdAngle: { type: hz.PropTypes.Number, default: 30 },
    targetingSoftThresholdTime: { type: hz.PropTypes.Number, default: 2 },
    debugTargetMarker: { type: hz.PropTypes.Entity, default: undefined },
  };

  private thresholdTimer: number = 0;
  private npc?: Npc;
  private npcPlayer?: NpcPlayer;
  private engagementPhase: NpcEngagementPhase = NpcEngagementPhase.Idle;
  private targetPosition?: hz.Vec3;
  private isTurning: boolean = false;

  preStart() {
    this.npc = this.props.npc!.as(Npc);

    this.connectNetworkEvent(this.npc!, NpcEvents.OnNpcEngagementChanged, (data) => {
      this.handleEngagementPhase(this.npc!, data.phase);
    });

    this.connectLocalBroadcastEvent(hz.World.onUpdate, data => this.onUpdate(data.deltaTime));
  }

  async start() {
    this.npcPlayer = await this.npc?.tryGetPlayer();
  }

  onUpdate(deltaTime:number) {
    if (!this.npcPlayer) {
      return;
    }

    let bodyPosition = this.npcPlayer!.position!.get();
    this.targetPosition = this.npcPlayer.getLookAtTarget();
    this.updateTargetMarker();

    if (!this.targetPosition) {
      return;
    }

    if (this.targetPosition.equals(hz.Vec3.zero)) {
      return;
    }

    if (this.isTurning) {
      return;
    }

    if (this.engagementPhase == NpcEngagementPhase.Idle) {
      var hardThresholdAngle = this.props.idlingHardThresholdAngle;
      var softThresholdAngle = this.props.idlingSoftThresholdAngle;
      var softThresholdTime = this.props.idlingSoftThresholdTime;
    }
    else {
      var hardThresholdAngle = this.props.targetingHardThresholdAngle;
      var softThresholdAngle = this.props.targetingSoftThresholdAngle;
      var softThresholdTime = this.props.targetingSoftThresholdTime;
    }

    let delta = this.targetPosition.sub(bodyPosition);
    // HORIZON BUG WORKAROUND: Guard .normalize() calls — Vec3.normalize() on a zero vector produces NaN.
    const deltaLenSq = delta.x * delta.x + delta.y * delta.y + delta.z * delta.z;
    delta = deltaLenSq > 0.0001 ? delta.normalize() : hz.Vec3.forward;
    delta.y = 0;
    const targetRotation = hz.Quaternion.lookRotation(delta, hz.Vec3.up).normalize();
    let currentRotation = this.npcPlayer!.rootRotation.get().normalize();
    let rotationDiff = this.getAngleBetweenQuaternions(currentRotation, targetRotation);

    if (rotationDiff > hardThresholdAngle) {
      let diff = this.targetPosition.sub(bodyPosition);
      diff.y = 0;
      // HORIZON BUG WORKAROUND: Guard .normalize() calls — Vec3.normalize() on a zero vector produces NaN.
      const diffLenSq = diff.x * diff.x + diff.y * diff.y + diff.z * diff.z;
      this.handleRotateTo(diffLenSq > 0.0001 ? diff.normalize() : hz.Vec3.forward);
      this.thresholdTimer = 0;
    }

    else if (rotationDiff > softThresholdAngle) {
      this.thresholdTimer += deltaTime;

      if (this.thresholdTimer > softThresholdTime) {
        let diff = this.targetPosition.sub(bodyPosition);
        diff.y = 0;
        // HORIZON BUG WORKAROUND: Guard .normalize() calls — Vec3.normalize() on a zero vector produces NaN.
        const diffLenSq2 = diff.x * diff.x + diff.y * diff.y + diff.z * diff.z;
        this.handleRotateTo(diffLenSq2 > 0.0001 ? diff.normalize() : hz.Vec3.forward);
        this.thresholdTimer = 0;
      }
    }
    else {
      this.thresholdTimer = 0;
    }
  }

  private updateTargetMarker() {
    if (!this.props.debugTargetMarker) {
      return;
    }
    // The target marker is for debugging purposes only.
    if (!this.targetPosition) {
      this.props.debugTargetMarker!.visible.set(false);
      return;
    }
    if (this.targetPosition.equals(hz.Vec3.zero)) {
      this.props.debugTargetMarker!.visible.set(false);
      return;
    }

    this.props.debugTargetMarker!.visible.set(true);
    this.props.debugTargetMarker!.position.set(this.targetPosition);

    if (this.engagementPhase == NpcEngagementPhase.Idle) {
      // set marker to yellow if NPC is idling
      this.props.debugTargetMarker!.color.set(hz.Color.fromHex('#FFFF00'));
    }
    else {
      // set marker to green if NPC is listening, reacting, or responding
      this.props.debugTargetMarker!.color.set(hz.Color.fromHex('#00FF00'));
    }
  }

  async handleRotateTo(direction: hz.Vec3) {
    this.isTurning = true;
    this.npcPlayer?.rotateTo(direction).then(() => {
      this.isTurning = false;
    });
  }

  private handleEngagementPhase(npc: Npc, phase: NpcEngagementPhase) {
    this.engagementPhase = phase;
  }

  getAngleBetweenQuaternions(q1: hz.Quaternion, q2: hz.Quaternion): number {
    // Calculate the dot product
    const dotProduct = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    // Clamp the dot product to [-1, 1]
    const clampedDot = Math.max(-1, Math.min(1, dotProduct));
    // Calculate the angle in radians and convert to degrees
    const angle = 2 * Math.acos(clampedDot) * (180 / Math.PI);

    return angle;
  }

}
hz.Component.register(npcAutoTurner);
