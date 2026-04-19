import * as hz from 'horizon/core';
import * as ui from 'horizon/ui';

type ProximityState = {
  lastProximityDist: number;
  isVisible: boolean;
  lastThreatPos: hz.Vec3 | null;
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions — use number, not any.
  sensorInterval: number | null; // Timer ID
  playerCheckInterval: number | null; // Timer ID
  currentThreatId: string;
  proximityTimeoutId: number | null; // Timer ID
  
  // PLAYER PROXIMITY
  nearestPlayerDist: number;
  nearestPlayerPos: hz.Vec3 | null;
  isTrackingPlayer: boolean;
  
  currentHealth: number;
};

/**
 * Handles the Proximity Radar / Sensor logic for the HUD.
 * Detects nearby zombies (Yellow) and friendly players (Blue).
 * REFACTORED: Now uses per-player state for Server-Side execution.
 */
export class HUD_ProximitySensor {
  
  // ---------------------------------------------------------
  // UI BINDINGS
  // ---------------------------------------------------------
  proximityDist = new ui.Binding<number>(999);
  proximityVisible = new ui.Binding<boolean>(false);
  proximityAngle = new ui.Binding<number>(0); 
  
  sensorUp = new ui.Binding<number>(0.05);
  sensorDown = new ui.Binding<number>(0.05);
  sensorLeft = new ui.Binding<number>(0.05);
  sensorRight = new ui.Binding<number>(0.05);
  
  sensorColor = new ui.Binding<string>('#FFFF00');
  warningText = new ui.Binding<string>('⚠ DANGER');
  
  // ---------------------------------------------------------
  // STATE STORE (Per Player ID)
  // ---------------------------------------------------------
  private playerStates = new Map<number, ProximityState>();

  // PARENT CONTEXT
  constructor(private parent: { 
      world: hz.World, 
      async: any, 
      getLocalPlayer: () => hz.Player | null 
  }) {}

  private getState(player: hz.Player): ProximityState {
    if (!this.playerStates.has(player.id)) {
      this.playerStates.set(player.id, {
        lastProximityDist: 999,
        isVisible: false,
        lastThreatPos: null,
        sensorInterval: null,
        playerCheckInterval: null,
        currentThreatId: "",
        proximityTimeoutId: null,
        nearestPlayerDist: 999,
        nearestPlayerPos: null,
        isTrackingPlayer: false,
        currentHealth: 10,
      });
    }
    return this.playerStates.get(player.id)!;
  }

  createView() {
    return ui.View({
        style: {
          position: 'absolute', top: 150, width: '100%', alignItems: 'center',
          display: this.proximityVisible.derive(v => v ? 'flex' : 'none'),
        },
        children: [
          ui.View({
            style: {
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            },
            children: [
              // WARNING BOX (LEFT)
              ui.View({
                style: {
                  padding: 10, borderRadius: 10, marginRight: 40,
                  backgroundColor: this.sensorColor.derive(c => {
                    // Yellow = danger (red bg), Blue = ally (blue bg)
                    if (c === '#00AAFF') {
                      return 'rgba(0, 100, 200, 0.6)';
                    }
                    // For danger, we can't derive intensity easily without per-player Binding or hacking it.
                    // Simplified: just return static red/blue background for now to avoid complexity
                    return 'rgba(255, 0, 0, 0.4)';
                  })
                },
                children: [
                  ui.Text({
                    text: this.warningText,
                    style: {
                      fontSize: 32, fontWeight: 'bold', fontFamily: 'Roboto-Mono',
                      color: '#ffffff', 
                      textShadowColor: '#000', textShadowOffset: [2, 2], textShadowRadius: 2,
                    }
                  }),
                ]
              }),
  
              // RADAR COMPASS (RIGHT)
              ui.View({
                style: {
                  width: 140, height: 140,
                  alignItems: 'center', justifyContent: 'center',
                },
                children: [
                  ui.View({ style: { position: 'absolute', top: 0 }, children: [this.radarDiamond(this.sensorUp)] }),
                  ui.View({ style: { position: 'absolute', bottom: 0 }, children: [this.radarDiamond(this.sensorDown)] }),
                  ui.View({ style: { position: 'absolute', left: 0 }, children: [this.radarDiamond(this.sensorLeft)] }),
                  ui.View({ style: { position: 'absolute', right: 0 }, children: [this.radarDiamond(this.sensorRight)] }),
                  
                  // CENTER DISTANCE TEXT
                  ui.Text({
                    text: this.proximityDist.derive(d => `${d.toFixed(1)}m`),
                    style: {
                      fontSize: 28, fontFamily: 'Roboto-Mono', color: '#ffcc00',
                      fontWeight: 'bold', textAlign: 'center',
                      textShadowColor: '#000', textShadowOffset: [1, 1], textShadowRadius: 2,
                      zIndex: 10,
                    }
                  }),
                ]
              })
            ]
          })
        ]
      });
  }

  private radarDiamond(binding: ui.Binding<number>) {
    return ui.View({
      style: {
        width: 30, height: 30,
        backgroundColor: this.sensorColor, 
        transform: [{ rotate: '45deg' }],
        borderWidth: 2, borderColor: '#FFFFFF',
        opacity: binding, 
      }
    });
  }

  dispose() {
    this.playerStates.forEach((state) => {
        if (state.sensorInterval) this.parent.async.clearInterval(state.sensorInterval);
        if (state.playerCheckInterval) this.parent.async.clearInterval(state.playerCheckInterval);
        if (state.proximityTimeoutId) this.parent.async.clearTimeout(state.proximityTimeoutId);
    });
    this.playerStates.clear();
  }

  onHealthChanged(newHealth: number, player: hz.Player) {
      const state = this.getState(player);
      state.currentHealth = newHealth;
      this.updateVisibility(player, state);
  }

  onZombieProximity(data: { dist: number, pos: { x: number, y: number, z: number }, id?: string, targetId?: string }, player: hz.Player) {
    if (!player) return;
    const state = this.getState(player);
    const myId = String(player.id);
    
    if (data.targetId && data.targetId !== myId) return;

    if (state.currentThreatId !== "" && 
        data.id && 
        data.id !== state.currentThreatId && 
        data.dist > state.lastProximityDist) {
      return; 
    }

    state.isTrackingPlayer = false;
    this.sensorColor.set('#FFFF00', [player]);
    this.warningText.set('⚠ DANGER', [player]);
    
    state.currentThreatId = data.id ?? "";
    this.proximityDist.set(data.dist, [player]);
    state.lastProximityDist = data.dist;
    
    state.lastThreatPos = new hz.Vec3(data.pos.x, data.pos.y, data.pos.z);
    
    this.updateVisibility(player, state);
    this.startSensorLoop(player, state); 
    
    if (state.proximityTimeoutId !== null) {
      this.parent.async.clearTimeout(state.proximityTimeoutId);
    }
    
    const capturedId = state.currentThreatId;
    state.proximityTimeoutId = this.parent.async.setTimeout(() => {
      if (state.currentThreatId === capturedId) {
        this.proximityDist.set(999, [player]);
        state.lastProximityDist = 999;
        state.lastThreatPos = null; 
        state.currentThreatId = "";
        this.updateVisibility(player, state);
        this.checkPlayerProximity(player, state);
      }
    }, 1000); 
  }

  private updateVisibility(player: hz.Player, state: ProximityState) {
    const zombieNearby = state.lastProximityDist < 20;
    const playerNearby = state.nearestPlayerDist < 15;
    const visible = (zombieNearby || playerNearby) && state.currentHealth > 0;
    
    this.proximityVisible.set(visible, [player]);
    state.isVisible = visible;
    
    if (!visible) {
      this.stopSensorLoop(state);
    }
  }

  startSensorLoop(player: hz.Player, state: ProximityState) {
    if (state.sensorInterval !== null) return;
    
    state.sensorInterval = this.parent.async.setInterval(() => {
      this.updateSensorDirection(player, state);
    }, 100); 
    
    // Auto-start player check if not running
    if (state.playerCheckInterval === null) {
         state.playerCheckInterval = this.parent.async.setInterval(() => {
            this.checkPlayerProximity(player, state);
        }, 500);
    }
  }

  stopSensorLoop(state: ProximityState) {
    if (state.sensorInterval !== null) {
      this.parent.async.clearInterval(state.sensorInterval);
      state.sensorInterval = null;
    }
    // Bindings reset only via updateSensorDirection or similar?
    // We can't easily reset bindings for one player without passing player to this method
    // But updateSensorDirection updates them every tick anyway.
  }
  
  // Public method called by HUD on join
  startPlayerProximityCheck(player: hz.Player) {
    const state = this.getState(player);
    if (state.playerCheckInterval !== null) return;
    
    state.playerCheckInterval = this.parent.async.setInterval(() => {
      this.checkPlayerProximity(player, state);
    }, 500);
  }
  
  stopPlayerProximityCheck(player: hz.Player) { // Added player arg
    const state = this.getState(player);
    if (state.playerCheckInterval !== null) {
      this.parent.async.clearInterval(state.playerCheckInterval);
      state.playerCheckInterval = null;
    }
  }

  private checkPlayerProximity(player: hz.Player, state: ProximityState) {
    if (!player) return;
    
    const world = this.parent.world;
    const myPos = player.position.get();
    const serverPlayerId = world.getServerPlayer().id;
    const allPlayers = world.getPlayers();
    
    let closestDist = 999;
    let closestPos: hz.Vec3 | null = null;
    
    for (const p of allPlayers) {
      if (p.id === player.id || p.id === serverPlayerId) continue;
      
      const pPos = p.position.get();
      // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
      const _dx = pPos.x - myPos.x, _dy = pPos.y - myPos.y, _dz = pPos.z - myPos.z;
      const dist = Math.sqrt(_dx * _dx + _dy * _dy + _dz * _dz);
      if (dist < closestDist) {
        closestDist = dist;
        closestPos = pPos;
      }
    }
    
    state.nearestPlayerDist = closestDist;
    state.nearestPlayerPos = closestPos;
    
    if (state.currentThreatId === "" && closestDist < 15 && state.currentHealth > 0) {
      state.isTrackingPlayer = true;
      this.sensorColor.set('#00AAFF', [player]);
      this.warningText.set('👥 ALLY', [player]);
      state.lastThreatPos = closestPos;
      state.lastProximityDist = closestDist;
      this.proximityDist.set(closestDist, [player]);
      this.updateVisibility(player, state);
      this.startSensorLoop(player, state);
    } else if (state.currentThreatId === "" && closestDist >= 15) {
      state.nearestPlayerPos = null;
      if (state.isTrackingPlayer) {
        state.isTrackingPlayer = false;
        state.lastProximityDist = 999;
        this.proximityDist.set(999, [player]);
        this.updateVisibility(player, state);
        this.stopSensorLoop(state);
      }
    }
  }

  private updateSensorDirection(player: hz.Player, state: ProximityState) {
    try {
      const targetPos = state.lastThreatPos;

      if (!targetPos || !state.isVisible) {
        this.sensorUp.set(0.05, [player]);
        this.sensorDown.set(0.05, [player]);
        this.sensorLeft.set(0.05, [player]);
        this.sensorRight.set(0.05, [player]);
        return;
      }

      const playerPos = player.position.get();
      const playerRot = player.rotation.get();

      const dx = targetPos.x - playerPos.x;
      const dy = targetPos.y - playerPos.y;
      const dz = targetPos.z - playerPos.z;
      const horizLenSq = dx * dx + dz * dz;

      if (horizLenSq < 0.001) return;

      // FIX: Recalculate distance every tick from player's current pos to last known
      // threat pos. This keeps the displayed distance accurate as the player moves,
      // even when no new proximity event has arrived yet.
      const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      state.lastProximityDist = dist3d;
      this.proximityDist.set(dist3d, [player]);

      const horizLen = Math.sqrt(horizLenSq);
      const dirX = dx / horizLen;
      const dirZ = dz / horizLen;

      const forward = hz.Quaternion.mulVec3(playerRot, hz.Vec3.forward);
      const right   = hz.Quaternion.mulVec3(playerRot, hz.Vec3.right);

      // Dot products: +1 = fully in that direction, 0 = perpendicular, -1 = opposite
      const forwardDot = dirX * forward.x + dirZ * forward.z;
      const rightDot   = dirX * right.x   + dirZ * right.z;

      const angle = Math.atan2(rightDot, forwardDot) * (180 / Math.PI);
      this.proximityAngle.set(angle, [player]);

      // FIX: Use dot products as per-diamond strength for smooth blending.
      // A threat at 45° now lights up BOTH adjacent diamonds proportionally
      // instead of snapping to whichever 90° zone it falls in.
      const fwd = Math.max(0, forwardDot);   // in front  → top    diamond
      const bck = Math.max(0, -forwardDot);  // behind    → bottom diamond
      const rgt = Math.max(0, rightDot);     // to right  → right  diamond
      const lft = Math.max(0, -rightDot);    // to left   → left   diamond

      const distanceIntensity = Math.max(0, 1 - (dist3d / 20));
      const now = Date.now();
      const pulseSpeed = 150 - (distanceIntensity * 100);
      const pulse = (Math.sin(now / pulseSpeed) + 1) / 2;

      const getOpacity = (strength: number): number => {
        if (strength < 0.05) return 0.05;
        const base = 0.3 + (distanceIntensity * 0.3);
        return Math.min(1.0, (base + pulse * (0.4 + distanceIntensity * 0.3)) * strength);
      };

      // FIX: Correct mapping — forward=top, behind=bottom, right=right, left=left
      this.sensorUp.set(getOpacity(fwd),    [player]);
      this.sensorDown.set(getOpacity(bck),  [player]);
      this.sensorRight.set(getOpacity(rgt), [player]);
      this.sensorLeft.set(getOpacity(lft),  [player]);

    } catch (e) { }
  }
}
