import * as hz from 'horizon/core';
import { Events } from 'Events';
import LocalCamera from 'horizon/camera';
import { WeaponConfig, DefaultWeapon, WeaponData } from 'WeaponConfig';

// ----------------------------
// INTERNAL TYPES
// ----------------------------
type GunState = {
  ammo: number;
};

const hideLine = new hz.CodeBlockEvent<[]>('hideLine', []);

// ----------------------------
//  GUN CONTROLLER
// ----------------------------
export class GunController extends hz.Component<typeof GunController> {
  static propsDefinition = {
    weaponId: { type: hz.PropTypes.Number, default: 3 },

    rayBullet:  { type: hz.PropTypes.Entity },
    shootSFX:   { type: hz.PropTypes.Entity },
    dryFireSFX: { type: hz.PropTypes.Entity },
    reloadSFX:  { type: hz.PropTypes.Entity },
    muzzleFlare:{ type: hz.PropTypes.Entity },
    bulletLine: { type: hz.PropTypes.Entity },
    hitVFX:     { type: hz.PropTypes.Entity },
    shellEject: { type: hz.PropTypes.Entity },
    pickupSFX:  { type: hz.PropTypes.Entity },

    knife:      { type: hz.PropTypes.Entity },
  };

  // -----------------------------------
  owner!: hz.Player;
  private ownerValid = false; // Track if owner is still in world
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store handle to cancel in cleanup().
  private handshakeTimer: number | null = null;
  private reloadTimer: number | null = null;

  ammo = 0;
  totalAmmo = 0;

  timeBetweenShots = 0;
  firing = false;
  holding = false;

  handedness = true;
  weapon!: WeaponData;

  shootButton!: hz.PlayerInput;
  reloadButton!: hz.PlayerInput;

  // -----------------------------------
  receiveOwnership(state: GunState | null, from: hz.Player) {
    if (from.id === this.world.getServerPlayer().id) return;
    this.totalAmmo = state?.ammo ?? this.weapon.totalAmmo;
  }

  transferOwnership(): GunState {
    return { ammo: this.totalAmmo };
  }

  // -----------------------------------
  preStart() {
    this.owner = this.entity.owner.get();

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnGrabStart, this.grab.bind(this));
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnGrabEnd,   this.letGo.bind(this));

    this.connectLocalBroadcastEvent(hz.World.onPrePhysicsUpdate, this.preUpdate.bind(this));
    this.connectCodeBlockEvent(this.entity, hideLine, this.hideLine.bind(this));

    // ❗ DO NOT connect network events here (owner not yet valid)
    // They are moved into start()
    this.weapon = WeaponConfig.get(this.props.weaponId) ?? DefaultWeapon;
  }

  // -----------------------------------
  start() {
    this.owner = this.entity.owner.get(); // Now it's the REAL player

    // Safety: Don't initialize if owner is server (Wait for Event)
    if (this.owner.id === this.world.getServerPlayer().id) {
       console.log('[Gun] Owned by server / Waiting for Assignment. Starting Handshake...');
       
       // 1. Listen for the response
       this.connectNetworkEvent(this.entity, Events.initializeWeapon, (data: { player: hz.Player }) => {
           console.log(`[Gun] Handshake Complete! Owned by ${data.player.name.get()}`);
           this.owner = data.player; // Force update owner
           this.initializeForPlayer();
       });

       // 2. Request ownership (Retry every 1s until initialized)
       this.handshakeTimer = this.async.setInterval(() => {
           if (this.ownerValid) {
               if (this.handshakeTimer !== null) {
                   this.async.clearInterval(this.handshakeTimer);
                   this.handshakeTimer = null;
               }
               return;
           }
           console.log('[Gun] Requesting ownership...');
           this.sendNetworkEvent(this.world.getServerPlayer(), Events.requestWeaponInit, { requestor: this.world.getLocalPlayer() });
       }, 1000);
       
       return;
    }

    // Server-Side: Listen for requests from clients (or if local on server)
    this.connectNetworkEvent(this.entity, Events.requestWeaponInit, this.checkOwnershipAndInit.bind(this));

    this.initializeForPlayer();
  }

  // SERVER: Responds to client handshake
  private checkOwnershipAndInit(data: { requestor: hz.Player }) {
      // If WE (the server script) know the owner is the requestor, tell them!
      if (this.owner && this.owner.id === data.requestor.id) {
          console.log(`[Gun] Confirming ownership to ${data.requestor.name.get()}`);
          this.sendNetworkEvent(data.requestor, Events.initializeWeapon, { player: this.owner });
      }
  }

  // Core initialization logic
  private initializeForPlayer(): void {
    // Mark owner as valid
    this.ownerValid = true;

    // Now it's safe to bind network events
    this.connectNetworkEvent(this.owner, Events.giveAmmo, this.giveAmmo.bind(this));
    this.connectNetworkBroadcastEvent(Events.startGame, this.fullAmmo.bind(this));

    this.ammo = this.weapon.magSize;
    this.totalAmmo = this.weapon.totalAmmo;

    this.ownership(this.owner);

    if (this.isLocal()) {
      this.entity.as(hz.AttachableEntity).attachToPlayer(this.owner, hz.AttachablePlayerAnchor.Torso);
      this.entity.as(hz.GrabbableEntity).setWhoCanGrab([this.owner]);

      this.sendHUD();
    }
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.handshakeTimer !== null) {
      this.async.clearInterval(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.reloadTimer !== null) {
      this.async.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  // Check if owner is still valid
  private isOwnerValid(): boolean {
    if (!this.ownerValid) return false;
    if (!this.owner) return false;
    try {
      // Accessing properties on invalid player throws
      return this.owner.isValidReference?.get() ?? true;
    } catch {
      this.ownerValid = false;
      return false;
    }
  }

  // -----------------------------------
  private sendHUD() {
    if (!this.isLocal()) return;

    this.sendNetworkEvent(this.owner, Events.viewAmmo, {
      ammo: this.ammo,
      totalAmmo: this.totalAmmo,
      maxMag: this.weapon.magSize
    });
  }

  // -----------------------------------
  ownership(player: hz.Player) {
    this.props.rayBullet?.owner.set(player);
    this.props.shootSFX?.owner.set(player);
    this.props.dryFireSFX?.owner.set(player);
    this.props.reloadSFX?.owner.set(player);
    this.props.muzzleFlare?.owner.set(player);
    this.props.hitVFX?.owner.set(player);
    this.props.bulletLine?.owner.set(player);
  }

  // -----------------------------------
  grab(isRight: boolean) {
    this.entity.as(hz.AttachableEntity).detach();
    this.handedness = isRight;
    this.holding = true;

    if (this.props.knife && this.webAndMobile()) {
      this.props.knife.as(hz.GrabbableEntity)?.forceHold(this.owner, hz.Handedness.Left, false);
    }

    this.connectShoot();
    this.connectReload();
  }

  letGo() {
    this.firing = false;
    this.holding = false;
    if (this.isOwnerValid()) {
      this.entity.as(hz.AttachableEntity).attachToPlayer(this.owner, hz.AttachablePlayerAnchor.Torso);
    }
  }

  // -----------------------------------
  preUpdate(data: { deltaTime: number }) {
    if (!this.isOwnerValid()) return; // Safety: skip if owner left
    
    this.timeBetweenShots += data.deltaTime;

    if (
      this.holding &&
      this.firing &&
      this.weapon.auto &&
      this.ammo > 0 &&
      this.totalAmmo > 0 &&
      this.timeBetweenShots >= this.weapon.shootDelayS
    ) {
      this.fire();
      this.timeBetweenShots = 0;
    }
  }

  // -----------------------------------
  connectShoot() {
    if (!this.isLocal()) return;

    const device = this.owner.deviceType.get();
    let input = device === hz.PlayerDeviceType.Mobile
      ? hz.PlayerInputAction.RightPrimary
      : (this.handedness ? hz.PlayerInputAction.RightTrigger : hz.PlayerInputAction.LeftTrigger);

    this.shootButton = hz.PlayerControls.connectLocalInput(input, hz.ButtonIcon.Fire, this);

    this.shootButton.registerCallback((_, down) => {
      if (!down) {
        this.firing = false;
        return;
      }
      this.triggerDown();
    });
  }

  triggerDown() {
    if (!this.holding) return;

    this.firing = true; // Always enable auto-fire loop

    if (this.ammo > 0 && this.timeBetweenShots >= this.weapon.shootDelayS) {
      this.fire();
      this.timeBetweenShots = 0;
      return;
    }

    if (this.ammo <= 0) {
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        const dryFireAudio = this.props.dryFireSFX?.as(hz.AudioGizmo);
        if (dryFireAudio) { dryFireAudio.stop(); dryFireAudio.play({ fade: 0, players: [this.owner] }); }
        (this.handedness ? this.owner.rightHand : this.owner.leftHand)
          .playHaptics(50, hz.HapticStrength.Medium, hz.HapticSharpness.Sharp);
    }
  }

  // -----------------------------------
  fire() {
    if (!this.isLocal()) return;

    this.totalAmmo--;
    this.ammo--;

    this.sendHUD();
    this.rayBullet();

    if (this.ammo === 0) this.pressReload();

    if (this.webAndMobile()) {
      this.owner.playAvatarGripPoseAnimationByName(hz.AvatarGripPoseAnimationNames.Fire);
    }

    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const shootAudio = this.props.shootSFX?.as(hz.AudioGizmo);
    if (shootAudio) { shootAudio.stop(); shootAudio.play(); }
    this.props.muzzleFlare?.as(hz.ParticleGizmo)?.play();
    this.props.shellEject?.as(hz.ParticleGizmo)?.play();

    // AI: Broadcast gunshot for zombie sound awareness
    this.sendNetworkBroadcastEvent(Events.gunshot, { 
        pos: this.props.rayBullet?.position.get() ?? this.entity.position.get()
    });

    (this.handedness ? this.owner.rightHand : this.owner.leftHand)
      .playHaptics(this.weapon.shootDelayS * 500, hz.HapticStrength.Strong, hz.HapticSharpness.Coarse);
  }

  // -----------------------------------
  connectReload() {
    if (!this.isLocal()) return;

    const device = this.owner.deviceType.get();
    const input =
      device === hz.PlayerDeviceType.Mobile
        ? hz.PlayerInputAction.RightSecondary
        : (device === hz.PlayerDeviceType.Desktop
            ? hz.PlayerInputAction.RightPrimary
            : (this.handedness ? hz.PlayerInputAction.RightSecondary : hz.PlayerInputAction.LeftSecondary));

    this.reloadButton = hz.PlayerControls.connectLocalInput(input, hz.ButtonIcon.Reload, this);

    this.reloadButton.registerCallback((_, down) => {
      if (down) this.pressReload();
    });
  }

  pressReload() {
    if (this.totalAmmo === 0 || this.ammo < 0) return;

    this.firing = false;
    this.ammo = -1;

    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const reloadAudio = this.props.reloadSFX?.as(hz.AudioGizmo);
    if (reloadAudio) { reloadAudio.stop(); reloadAudio.play({ fade: 0, players: [this.owner] }); }

    (this.handedness ? this.owner.rightHand : this.owner.leftHand)
      .playHaptics(50, hz.HapticStrength.Medium, hz.HapticSharpness.Soft);

    if (this.webAndMobile()) {
      this.owner.playAvatarGripPoseAnimationByName(hz.AvatarGripPoseAnimationNames.Reload);
    }

    // BUG FIX: Store timer so cleanup() can cancel it if the gun is dropped or owner leaves mid-reload.
    // Also guards against double-reload if pressReload() is somehow called twice.
    if (this.reloadTimer !== null) this.async.clearTimeout(this.reloadTimer);
    this.reloadTimer = this.async.setTimeout(() => {
      this.reloadTimer = null;
      this.reload();
    }, this.weapon.reloadTimeS * 1000);
  }

  reload() {
    this.ammo = this.weapon.magSize;
    this.sendHUD();
  }

  // -----------------------------------
  rayBullet() {
    const ray = this.props.rayBullet;
    if (!ray) return;

    const pos = ray.position.get();
    let rawDir = this.webAndMobile()
      ? LocalCamera.lookAtPosition.get().sub(pos)
      : ray.forward.get();
    // HORIZON BUG WORKAROUND: Guard .normalize() calls — check length > 0 before normalizing.
    const rawDirLenSq = rawDir.x * rawDir.x + rawDir.y * rawDir.y + rawDir.z * rawDir.z;
    const dir = rawDirLenSq > 0.0001 ? rawDir.normalize() : hz.Vec3.forward;

    const result = ray.as(hz.RaycastGizmo)?.raycast(pos, dir);
    if (!result) return;

    const line = this.props.bulletLine;
    if (line) {
      line.position.set(hz.Vec3.lerp(pos, result.hitPoint, 0.5));
      line.rotation.set(hz.Quaternion.lookRotation(dir.mul(-1)));
      line.scale.set(new hz.Vec3(0.07, 0.07, result.distance / 2));
    }

    this.sendCodeBlockEvent(this.entity, hideLine);

    if (result.targetType === hz.RaycastTargetType.Entity) {
      this.sendNetworkEvent(result.target, Events.hitZombie, { 
          damage: this.weapon.damage,
          instigator: this.owner,
          hitPos: result.hitPoint // Send hit position for Headshot calc
      });
    }

    this.props.hitVFX?.position.set(result.hitPoint);
    this.props.hitVFX?.as(hz.ParticleGizmo)?.play();
  }

  // -----------------------------------
  giveAmmo() {
    if (!this.isLocal()) return;

    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const pickupAudio = this.props.pickupSFX?.as(hz.AudioGizmo);
    if (pickupAudio) { pickupAudio.stop(); pickupAudio.play({ fade: 0, players: [this.owner] }); }

    this.totalAmmo += 100;
    this.sendHUD();
  }

  // -----------------------------------
  fullAmmo() {
    if (!this.isLocal()) return;

    this.totalAmmo = this.weapon.totalAmmo;
    this.ammo = this.weapon.magSize;
    this.sendHUD();
  }

  // -----------------------------------
  hideLine() {
    this.props.bulletLine?.position.set(new hz.Vec3(0, -100, 0));
  }

  // -----------------------------------
  isLocal() {
    return this.entity.owner.get().id !== this.world.getServerPlayer().id;
  }

  webAndMobile() {
    if (!this.isLocal()) return false;
    return this.owner.deviceType.get() !== hz.PlayerDeviceType.VR;
  }
}

hz.Component.register(GunController);

// ---------------------------------------------------------------------------
// WEAPONS
// ---------------------------------------------------------------------------

