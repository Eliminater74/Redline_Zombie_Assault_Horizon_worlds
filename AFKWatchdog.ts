import * as hz from 'horizon/core';
import { Events } from 'Events';
import { GameConfig } from 'GameConfig';
import { alivePlayers, ignoredPlayerIds } from 'GameState';

/**
 * AFKWatchdog
 * Monitors player activity and handles "Soft AFK" (Iteraction) and "Hard Kick".
 * Can be attached to any empty object.
 */
class AFKWatchdog extends hz.Component<typeof AFKWatchdog> {
  static propsDefinition = {
    softAfkSeconds: { type: hz.PropTypes.Number, default: 20 },  // Ignore by Zombies
    kickSeconds: { type: hz.PropTypes.Number, default: 90 },     // Kill/Respawn
    adminOnly: { type: hz.PropTypes.Boolean, default: true },    // Only runs on server
  };

  private playerLastPos = new Map<number, hz.Vec3>();
  private playerLastRot = new Map<number, hz.Quaternion>();
  private playerIdleTime = new Map<number, number>();
  private checkTimer: number | null = null;

  start() {
    // Only run on Server (owner of this object must be server player for it to work correctly universally)
    // Or we explicitly check isServer().
    if (this.props.adminOnly && !this.isServer()) return;

    this.startWatchdog();
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.checkTimer !== null) {
      this.async.clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private isServer(): boolean {
    return this.world.getServerPlayer().id === this.entity.owner.get().id;
  }

  private startWatchdog() {
    // Loop every 1 second
    this.checkTimer = this.async.setInterval(() => {
        this.checkLoop();
    }, 1000);
  }

  private checkLoop() {
    const softLimit = this.props.softAfkSeconds ?? 20;
    const kickLimit = this.props.kickSeconds ?? 90;

    // Check all ALIVE players (imported from PlayerManager)
    alivePlayers.forEach(p => {
        // Moderator check
        if (GameConfig.isModerator(p.name.get())) return;

        const currentPos = p.position.get();
        const currentRot = p.rotation.get();
        const lastPos = this.playerLastPos.get(p.id);
        const lastRot = this.playerLastRot.get(p.id);

        let isActive = false;

        if (lastPos && lastRot) {
             // 0.3m movement threshold
             // HORIZON BUG WORKAROUND: Vec3.distanceSquared() broken in HW — use manual dot product.
             const _afkDx = currentPos.x - lastPos.x, _afkDy = currentPos.y - lastPos.y, _afkDz = currentPos.z - lastPos.z;
             if ((_afkDx * _afkDx + _afkDy * _afkDy + _afkDz * _afkDz) >= 0.09) isActive = true;
             
             // Rotation check
             const rotDiff = Math.abs(currentRot.x - lastRot.x) + 
                             Math.abs(currentRot.y - lastRot.y) + 
                             Math.abs(currentRot.z - lastRot.z) + 
                             Math.abs(currentRot.w - lastRot.w);
             if (rotDiff > 0.01) isActive = true;
        }

        if (isActive) {
             this.playerIdleTime.set(p.id, 0);
             ignoredPlayerIds.delete(p.id); // Valid target again
        } else if (lastPos) {
             // Increment idle time
             const idleSec = (this.playerIdleTime.get(p.id) ?? 0) + 1;
             this.playerIdleTime.set(p.id, idleSec);

             // STAGE 1: SOFT AFK
             if (idleSec >= softLimit) {
                 ignoredPlayerIds.add(p.id);
             }

             // STAGE 2: HARD KICK
             if (idleSec >= kickLimit) {
                 console.log(`[AFKWatchdog] Kicking ${p.name.get()}`);
                 // Tell PlayerManager to kill them via Event
                 this.sendNetworkBroadcastEvent(Events.killPlayer, { 
                     player: p, 
                     reason: "AFK LIMIT" 
                 });
                 // Reset timer so we don't spam kick events every second while they respawn
                 this.playerIdleTime.set(p.id, 0);
             }
        }

        this.playerLastPos.set(p.id, currentPos);
        this.playerLastRot.set(p.id, currentRot);
    });
  }
}

hz.Component.register(AFKWatchdog);
