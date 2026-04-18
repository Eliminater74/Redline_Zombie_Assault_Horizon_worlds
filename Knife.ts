import * as hz from 'horizon/core';
import { Events } from 'Events';

const damage: number = 100
const hitDelay: number = 1

class Knife extends hz.Component<typeof Knife> {
  static propsDefinition = {
    trigger: {type: hz.PropTypes.Entity},
    hitSFX: {type: hz.PropTypes.Entity}
  };

  owner!: hz.Player;
  canHit: boolean = true;
  // BUG FIX: Store handle so cleanup() can cancel an in-flight cooldown when the knife is despawned.
  private hitCooldownTimer: number | null = null;

  preStart(): void {
    // Safety check for owner
    const owner = this.entity.owner.get();
    if (owner) this.owner = owner;

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnGrabEnd, this.letGo.bind(this));
    
    if(this.props.trigger)
      this.connectCodeBlockEvent(this.props.trigger, hz.CodeBlockEvents.OnEntityEnterTrigger, this.hitZombie.bind(this))
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.hitCooldownTimer !== null) {
      this.async.clearTimeout(this.hitCooldownTimer);
      this.hitCooldownTimer = null;
    }
  }

  start() {
    if (!this.owner) return;

    // --- SAFETY FIX START ---
    // Prevents crash if the knife is sitting in the world (owned by Server)
    const serverId = this.world.getServerPlayer().id;
    if (this.owner.id === serverId) return; 
    // --- SAFETY FIX END ---

    this.ownership(this.owner);
    
    if (this.isLocal()) {
      this.entity.as(hz.GrabbableEntity).setWhoCanGrab([this.owner])
      this.entity.as(hz.GrabbableEntity).forceHold(this.owner, hz.Handedness.Left, true)
    }
  }

  ownership(owner: hz.Player){ 
    this.props.trigger?.owner.set(owner)
  }

  letGo(){ 
    this.entity.as(hz.AttachableEntity).attachToPlayer(this.owner, hz.AttachablePlayerAnchor.Torso)
  }

  hitZombie(zombie: hz.Entity){ 
    if(!this.canHit) return
    
    // Original hit logic (No tag checks, hits everything)
    this.sendNetworkEvent(zombie, Events.hitZombie, {damage})
    
    if(this.props.hitSFX) {
      const hitAudio = this.props.hitSFX.as(hz.AudioGizmo);
      if (hitAudio) {
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        hitAudio.stop();
        hitAudio.play();
      }
    }
    
    this.canHit = false;

    this.hitCooldownTimer = this.async.setTimeout(() => {
      this.hitCooldownTimer = null;
      this.canHit = true;
    }, hitDelay * 1000);
  }

  isLocal(): boolean { 
    if (!this.owner) return false;
    return (this.owner.id != this.world.getServerPlayer().id);
  }

  webAndMobile(): boolean { 
    if (!this.isLocal())
      return false
    return this.owner.deviceType.get() !== hz.PlayerDeviceType.VR
  }
}
hz.Component.register(Knife);