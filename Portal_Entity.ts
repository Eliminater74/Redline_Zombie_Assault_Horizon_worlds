import { AudioGizmo, Component, ParticleGizmo, Player, PropTypes, SpawnPointGizmo, Vec3 } from "horizon/core";
import { portal_Data } from "Portal_Data";
import { AccessControl } from "AccessControl";


class Portal_Entity extends Component<typeof Portal_Entity> {
  static propsDefinition = {
    detectionDistanceMeters: { type: PropTypes.Number, default: 15 },

    isUsingRandomSpawnPoints: { type: PropTypes.Boolean, default: false },
    nonRandomDefaultSpawnPoint: { type: PropTypes.Entity },

    portalAppearSFX: { type: PropTypes.Entity },
    portalAppearVFX: { type: PropTypes.Entity },
    openPortalSFX: { type: PropTypes.Entity },
    openPortalVFX: { type: PropTypes.Entity },
    teleportSFX: { type: PropTypes.Entity },
    teleportVFX: { type: PropTypes.Entity },
    closePortalSFX: { type: PropTypes.Entity },
    closePortalVFX: { type: PropTypes.Entity },
  };

  portalPos = Vec3.zero;

  hasAlreadyOpened = false;
  hasAlreadyPlayedFX = false;


  private proximityInterval: number | null = null;

  start() {
    this.setVisibleState(false);

    this.portalPos = this.entity.position.get();

    // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store handle in cleanup().
    this.proximityInterval = this.async.setInterval(() => { this.checkForNearbyPlayers(); }, 250);
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.proximityInterval !== null) {
      this.async.clearInterval(this.proximityInterval);
      this.proximityInterval = null;
    }
  }

  checkForNearbyPlayers() {
    this.hasAlreadyPlayedFX = false;
    
    const playersNearby: Player[] = [];
    const allPlayers = this.world.getPlayers() ?? [];

    allPlayers.forEach((player) => {
      const playerPos = player.position.get();
      // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
      const _peDx = this.portalPos.x - playerPos.x, _peDy = this.portalPos.y - playerPos.y, _peDz = this.portalPos.z - playerPos.z;
      const dist = Math.sqrt(_peDx * _peDx + _peDy * _peDy + _peDz * _peDz);

      // ACCESS CONTROL: Skip unauthorized players entirely
      if (!AccessControl.hasAccess(player, this.entity)) return;

      if (dist < this.props.detectionDistanceMeters) {
        playersNearby.push(player);
      }

      if (dist < 3) {
        if (!this.hasAlreadyPlayedFX) {
          this.hasAlreadyPlayedFX = true;

          this.props.teleportSFX?.as(AudioGizmo)?.position.set(player.position.get());
          this.props.teleportVFX?.as(ParticleGizmo)?.position.set(player.position.get());

          // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
          const teleportAudio = this.props.teleportSFX?.as(AudioGizmo);
          if (teleportAudio) { teleportAudio.stop(); teleportAudio.play(); }
          this.props.teleportVFX?.as(ParticleGizmo)?.play();

          this.teleportNearbyPlayer(player);
        }
      }
    });

    if (playersNearby.length === 1) {
      if (!this.hasAlreadyOpened) {
        this.openPortal();
      }
    }

    if (playersNearby.length === 0) {
      if (this.hasAlreadyOpened) {
        this.closePortal();
      }
    }
  }

  openPortal() {
    this.hasAlreadyOpened = true;
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const appearSFX = this.props.portalAppearSFX?.as(AudioGizmo);
    if (appearSFX) { appearSFX.stop(); appearSFX.play(); }
    this.props.portalAppearVFX?.as(ParticleGizmo)?.play();

    this.setVisibleState(true);

    const openSFX = this.props.openPortalSFX?.as(AudioGizmo);
    if (openSFX) { openSFX.stop(); openSFX.play({ fade: 1 }); }
    this.props.openPortalVFX?.as(ParticleGizmo)?.play();
  }

  teleportNearbyPlayer(player: Player) {
    if (this.props.isUsingRandomSpawnPoints && portal_Data.randomSpawnPointArray.length > 0) {
      const spawnPointIndex = Math.floor(portal_Data.randomSpawnPointArray.length * Math.random());

      const randomSpawnPoint = portal_Data.randomSpawnPointArray[spawnPointIndex];

      randomSpawnPoint.teleportPlayer(player);
    }
    else {
      this.props.nonRandomDefaultSpawnPoint?.as(SpawnPointGizmo)?.teleportPlayer(player);
    }
  }

  closePortal() {
    this.hasAlreadyOpened = false;

    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    const closeSFX = this.props.closePortalSFX?.as(AudioGizmo);
    if (closeSFX) { closeSFX.stop(); closeSFX.play(); }
    this.props.closePortalVFX?.as(ParticleGizmo)?.play();

    this.setVisibleState(false);

    this.props.openPortalSFX?.as(AudioGizmo)?.stop({ fade: 1 });
    this.props.openPortalVFX?.as(ParticleGizmo)?.stop();
  }

  setVisibleState(isOn: boolean) {
    this.entity.visible.set(isOn);
    this.entity.collidable.set(isOn);
  }
}
Component.register(Portal_Entity);