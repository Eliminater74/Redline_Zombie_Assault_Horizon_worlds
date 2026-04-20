import * as hz from 'horizon/core';
import * as ui from 'horizon/ui';
import { Events } from 'Events';
import { playerLookupMap } from 'GameState';
import { HUD_ProximitySensor } from './HUD_ProximitySensor';
import { HUD_KillFeed } from './HUD_KillFeed';
import { HUD_PlayerList } from './HUD_PlayerList';
import { HUD_PlayerStats } from './HUD_PlayerStats';

/**
 * HUD COMPONENT (Optimized v2.1)
 *
 * Handles all UI rendering for the player including Health, Ammo, Wave info,
 * and notifications (Kill feed, Level ups).
 *
 * OPTIMIZATION NOTES:
 * - Uses strict subscription management to prevent memory leaks.
 * - Validates player references before async callbacks.
 * - Throttles frequent UI updates where applicable.
 */
export class HUD extends ui.UIComponent<typeof HUD> {

  static propsDefinition = {
    heart: { type: hz.PropTypes.Asset },
    bullet: { type: hz.PropTypes.Asset }, 
  };

  // ---------------------------------------------------------
  // UI BINDINGS
  // ---------------------------------------------------------
  health = new ui.Binding<number>(20);
  
  // Damage Flash Opacity (0 = invisible, 0.6 = red screen)
  damageAlpha = new ui.Binding<number>(0);
  lowHealthAlpha = new ui.Binding<number>(0); // Persistent tint for < 30% health

  totalAmmo = new ui.Binding<number>(180);
  magAmmo = new ui.Binding<number>(30);
  maxMag = new ui.Binding<number>(30);
  ammoWidth = new ui.Binding<string>('100%');
  
  wave = new ui.Binding<number>(1);
  waveScale = new ui.Binding<number>(1); 

  // Game End Notification
  gameEndVisible = new ui.Binding<boolean>(false);
  gameEndTimer = new ui.Binding<number>(10);
  gameEndTriggeredBy = new ui.Binding<string>(''); 
  
  // Join Notification
  joinMsg = new ui.Binding<string>('');
  joinMsgVisible = new ui.Binding<boolean>(false);

  // Zombie Counter
  zombieCount = new ui.Binding<number>(0);
  zombieTotal = new ui.Binding<number>(1);
  zombiePercent = new ui.Binding<number>(0);
  waveTotal = new ui.Binding<number>(0); // Total zombies for this wave
  zombieText = new ui.Binding<string>('Zombies: 0 / 0'); // Combined display text
  zombieDebugText = new ui.Binding<string>('A:0 L:0 P:0 Q:0');

  // HEADSHOT INDICATOR - Shows "HEADSHOT! 3x" when landing a headshot
  headshotVisible = new ui.Binding<boolean>(false);
  headshotMultiplier = new ui.Binding<string>('2x');
  headshotScale = new ui.Binding<number>(1);
  headshotOpacity = new ui.Binding<number>(0); // For smooth visibility

  // COMBO INDICATOR - Shows "COMBO 3x!"
  comboVisible = new ui.Binding<boolean>(false);
  comboText = new ui.Binding<string>('');
  comboScale = new ui.Binding<number>(1);


  // PER-PLAYER STATE MAPS (Server Support)
  private lastHealthMap = new Map<number, number>();
  private maxMagMap = new Map<number, number>();

  // MEMORY LEAK FIX: Track subscriptions per player
  // Stores cleanup functions for event listeners to ensure they are removed on player exit
  private playerSubs = new Map<number, { disconnect: () => void }[]>();

  // ---------------------------------------------------------
  // SUB-COMPONENTS
  // ---------------------------------------------------------
  private proximitySensor!: HUD_ProximitySensor;
  private killFeed!: HUD_KillFeed;
  private playerList!: HUD_PlayerList;
  private playerStats!: HUD_PlayerStats;

  // Clock
  clockTime = new ui.Binding<string>('');
  private clockInterval: number | null = null;

  // WAVE STATE (for headshot multiplier - Global is fine for Wave)
  private currentWave = 1;
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — store handle to cancel in dispose().
  private gameEndInterval: number | null = null;

  // ---------------------------------------------------------
  // PRESTART
  // ---------------------------------------------------------
  preStart(): void {
    console.log("[HUD] Script Loaded v26.0.0");
    
    // Initialize Sub-Components if not already done
    if (!this.proximitySensor) this.proximitySensor = new HUD_ProximitySensor(this);
    if (!this.killFeed) this.killFeed = new HUD_KillFeed(this);
    if (!this.playerList) this.playerList = new HUD_PlayerList(this);
    if (!this.playerStats) this.playerStats = new HUD_PlayerStats(this);

    // Global Events (Not player-specific)
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterWorld,
      player => this.onPlayerJoin(player)
    );

    // Network Events (Self-targeted usually, but good to have)
    this.connectNetworkEvent(this.entity, Events.viewHealth, this.viewHealth.bind(this));
    this.connectNetworkEvent(this.entity, Events.viewWave, this.viewWave.bind(this));
    this.connectNetworkEvent(this.entity, Events.viewAmmo, this.viewAmmo.bind(this));
    
    this.killFeed.refreshKillCount();
    
    // Broadcast Events
    this.connectNetworkBroadcastEvent(Events.gameEnding, this.onGameEnding.bind(this));
    this.connectNetworkBroadcastEvent(Events.playerDied, this.onPlayerDied.bind(this));
    this.connectNetworkBroadcastEvent(Events.playerJoined, this.onPlayerJoined.bind(this));
    this.connectNetworkBroadcastEvent(Events.updateZombieCount, this.onUpdateZombieCount.bind(this));
    this.connectNetworkBroadcastEvent(Events.updatePlayerList, this.onUpdatePlayerList.bind(this));
    
    // Local Broadcasts (From other scripts on same client/server)
    this.connectLocalBroadcastEvent(Events.zombieProximity, this.onZombieProximity.bind(this));
    this.connectLocalBroadcastEvent(Events.playerHeadshot, (data) => this.onPlayerHeadshot(data.player));
    
    // Important Cleanup Hook
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerExitWorld, this.onPlayerExitWorld.bind(this));
  }

  // ---------------------------------------------------------
  // START - Begin proximity checks automatically
  // ---------------------------------------------------------
  start(): void {
    // SAFETY: Attach listeners for all players already in the world (including self)
    // This fixes edge cases where script reloads or players join before script is ready.
    const players = this.world.getPlayers();
    players.forEach(p => this.onPlayerJoin(p));

    // Local clock — manual 12-hour format (toLocaleTimeString options unsupported in HW runtime).
    const getTime = () => {
      const d = new Date();
      let h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, '0');
      const s = d.getSeconds().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m}:${s} ${ampm}`;
    };
    this.clockTime.set(getTime());
    this.clockInterval = this.async.setInterval(() => {
      this.clockTime.set(getTime());
    }, 1000);
  }

  // ---------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------
  dispose(): void {
    // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in dispose().
    if (this.clockInterval !== null) {
      this.async.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.gameEndInterval !== null) {
      this.async.clearInterval(this.gameEndInterval);
      this.gameEndInterval = null;
    }

    // Clean up sub-components
    this.proximitySensor?.dispose();
    this.killFeed?.dispose();
    this.playerList?.dispose();
    this.playerStats?.dispose();

    // Clean up all player subscriptions
    this.playerSubs.forEach(subs => subs.forEach(s => s.disconnect()));
    this.playerSubs.clear();
  }

  // ---------------------------------------------------------
  // DELEGATES & HELPERS
  // ---------------------------------------------------------

  /**
   * Updates kill count for local player if applicable.
   * Delegated to HUD_KillFeed.
   */
  onUpdateKillCount(data: { count: number, player: hz.Player }) {
    const localPlayer = this.getLocalPlayer();
    if (localPlayer) {
        // Check ID match OR Name match (fallback for simulation ID shifts)
        const idMatch = String(localPlayer.id) === String(data.player.id);
        const nameMatch = localPlayer.name.get() === data.player.name.get();
        
        if (idMatch || nameMatch) {
            this.killFeed.onUpdateKillCount(data);
        }
    }
  }

  refreshKillCount() {
    if (this.killFeed) this.killFeed.refreshKillCount();
  }

  onUpdatePlayerList(data: { players: Array<{ name: string, status: string }> }) {
    this.playerList.onUpdatePlayerList(data);
  }

  // ---------------------------------------------------------
  // PLAYER JOIN (Subscription Management)
  // ---------------------------------------------------------
  onPlayerJoin(player: hz.Player) {
    if (!player) return;

    // OPTIMIZATION: Idempotency Check
    // If we already have subs for this player, clean them up first to avoid duplicates.
    // This handles the case where start() calls this on existing players who might also
    // trigger OnPlayerEnterWorld.
    if (this.playerSubs.has(player.id)) {
        this.onPlayerExitWorld(player);
    }

    // Start proximity check loop for this player
    this.proximitySensor.startPlayerProximityCheck(player);

    // Register all network event listeners for this specific player
    // These will be automatically cleaned up on exit via registerPlayerSubscription

    // 1. Ammo Update
    const sub1 = this.connectNetworkEvent(
      player,
      Events.viewAmmo,
      (data: { ammo: number; totalAmmo: number; maxMag?: number }) => {
        this.viewAmmo({ ammo: data.ammo, totalAmmo: data.totalAmmo, maxMag: data.maxMag, player });
      }
    );
    this.registerPlayerSubscription(player, sub1);

    // 2. Health Update
    const sub2 = this.connectNetworkEvent(
      player,
      Events.viewHealth,
      (data: { health: number }) => {
        this.viewHealth({ health: data.health, player });
      }
    );
    this.registerPlayerSubscription(player, sub2);

    // 3. Wave Update
    const sub3 = this.connectNetworkEvent(
      player,
      Events.viewWave,
      (data: { wave: number }) => {
        this.viewWave({ wave: data.wave }); 
      }
    );
    this.registerPlayerSubscription(player, sub3);
    
    // 4. Combo Update
    const sub4 = this.connectNetworkEvent(
      player,
      Events.playerCombo,
      (data: { multiplier: number, count: number }) => {
        this.onPlayerCombo(data, player);
      }
    );
    this.registerPlayerSubscription(player, sub4);
    
    // 5. Stats Panel Update
    const sub5 = this.connectNetworkEvent(
      player,
      Events.viewPlayerStats,
      (data: { visits: number, highestWave: number, kills: number, headshots: number }) => {
         this.playerStats.onUpdatePlayerStats(data, player);
         // Sync legacy kill counter
         this.killFeed.onUpdateKillCount({ count: data.kills, player: player });
      }
    );
    this.registerPlayerSubscription(player, sub5);

    // 6. Level System Events (Delegated)
    this.playerStats.setupPlayerLevelEvents(player);
  }

  // ---------------------------------------------------------
  // PLAYER EXIT (Cleanup)
  // ---------------------------------------------------------
  onPlayerExitWorld(player: hz.Player) {
    if (!player) return;
    
    // 1. Stop Proximity Check
    this.proximitySensor.stopPlayerProximityCheck(player);

    // 2. Disconnect all events
    const subs = this.playerSubs.get(player.id);
    if (subs) {
        subs.forEach(s => s.disconnect());
        this.playerSubs.delete(player.id);
    }

    // 3. Clear State Maps
    this.lastHealthMap.delete(player.id);
    this.maxMagMap.delete(player.id);
  }

  /**
   * Registers a subscription to be cleaned up when the player leaves.
   */
  registerPlayerSubscription(player: hz.Player, sub: { disconnect: () => void }) {
      if (!sub) return;
      if (!this.playerSubs.has(player.id)) {
          this.playerSubs.set(player.id, []);
      }
      this.playerSubs.get(player.id)!.push(sub);
  }

  // ---------------------------------------------------------
  // HEALTH UPDATE (With Damage Flash!)
  // ---------------------------------------------------------
  viewHealth(data: { health: number; player: hz.Player }) {
    // Validate player exists before updating
    if (!data.player || !data.player.isValidReference.get()) return;

    const lastHealth = this.lastHealthMap.get(data.player.id) ?? 10;
    
    // Trigger flash if taking damage
    if (data.health < lastHealth) {
      this.triggerDamageFlash(data.player);
    }
    
    // Low Health Warning Tint
    if (data.health <= 30) {
        this.lowHealthAlpha.set(0.3, [data.player]);
    } else {
        this.lowHealthAlpha.set(0.0, [data.player]);
    }

    this.lastHealthMap.set(data.player.id, data.health);
    this.health.set(data.health, [data.player]);
    
    // Update Proximity Sensor visibility based on health
    this.proximitySensor.onHealthChanged(data.health, data.player);
  }

  triggerDamageFlash(player: hz.Player) {
    // Validate reference for async safety
    if (!player.isValidReference.get()) return;

    this.damageAlpha.set(0.6, [player]);
    this.async.setTimeout(() => {
      // Re-validate inside timeout
      if (player && player.isValidReference.get()) {
        this.damageAlpha.set(0.0, [player]);
      }
    }, 150);
  }

  // ---------------------------------------------------------
  // AMMO UPDATE
  // ---------------------------------------------------------
  viewAmmo(data: { ammo: number; totalAmmo: number; maxMag?: number; player: hz.Player }) {
    if (!data.player || !data.player.isValidReference.get()) return;

    this.magAmmo.set(data.ammo, [data.player]);
    this.totalAmmo.set(data.totalAmmo, [data.player]);

    let maxMag = this.maxMagMap.get(data.player.id) ?? 30;
    if (data.maxMag !== undefined) {
      maxMag = data.maxMag;
      this.maxMagMap.set(data.player.id, maxMag);
      this.maxMag.set(data.maxMag, [data.player]);
    }

    // Calculate percentage for progress bar
    const percent = Math.max(0, Math.min(100, (data.ammo / maxMag) * 100));
    this.ammoWidth.set(`${percent}%`, [data.player]);
  }

  // ---------------------------------------------------------
  // WAVE UPDATE (With "Pop" Animation!)
  // ---------------------------------------------------------
  viewWave(data: { wave: number }) {
    this.currentWave = data.wave; // Synced with server
    this.wave.set(data.wave);
    this.waveScale.set(1.5); 
    this.async.setTimeout(() => {
      this.waveScale.set(1.0);
    }, 300);
  }
  
  // ---------------------------------------------------------
  // COMBO EVENT (Delegated View, but Data Handling here)
  // ---------------------------------------------------------
  onPlayerCombo(data: { multiplier: number, count: number }, player: hz.Player) {
      if (!player) return;
      
      this.comboText.set(`COMBO ${data.multiplier}x!`, [player]);
      this.comboVisible.set(true, [player]);
      this.comboScale.set(1.5, [player]);
      
      this.async.setTimeout(() => {
          if (player.isValidReference.get()) {
              this.comboScale.set(1.0, [player]);
          }
      }, 150);
      
      this.async.setTimeout(() => {
          if (player.isValidReference.get()) {
              this.comboVisible.set(false, [player]);
          }
      }, 2000);
  }

  // ---------------------------------------------------------
  // GAME ENDING NOTIFICATION
  // ---------------------------------------------------------
  onGameEnding(data: { seconds: number, triggeredBy: string }) {
    // HORIZON BUG WORKAROUND: Timer/Interval race conditions — cancel any existing interval before starting a new one.
    if (this.gameEndInterval !== null) {
      this.async.clearInterval(this.gameEndInterval);
      this.gameEndInterval = null;
    }

    this.gameEndVisible.set(true);
    this.gameEndTriggeredBy.set(data.triggeredBy);
    this.gameEndTimer.set(data.seconds);

    let localSeconds = data.seconds;
    this.gameEndInterval = this.async.setInterval(() => {
      localSeconds--;
      this.gameEndTimer.set(localSeconds);
      if (localSeconds <= 0) {
        if (this.gameEndInterval !== null) {
          this.async.clearInterval(this.gameEndInterval);
          this.gameEndInterval = null;
        }
        this.gameEndVisible.set(false);
      }
    }, 1000);
  }

  // ---------------------------------------------------------
  // DEATH NOTIFICATION DELEGATE
  // ---------------------------------------------------------
  onPlayerDied(data: { name: string }) {
    this.killFeed.onPlayerDied(data);
  }

  // ---------------------------------------------------------
  // ZOMBIE COUNTER
  // ---------------------------------------------------------
  onUpdateZombieCount(data: { count: number, total: number, waveTotal: number, remaining: number, loading: number, pending: number, toSpawn: number }) {
    const active = Math.max(0, data.count);
    const unresolved = Math.max(0, data.remaining);
    const totalLeft = active + unresolved;
    const waveSize = Math.max(1, data.waveTotal > 0 ? data.waveTotal : Math.max(totalLeft, data.total));
    const isWaveStartSpawn = active === 0 && totalLeft > 0 && totalLeft === waveSize;
    const loading = Math.max(0, data.loading);
    const pending = Math.max(0, data.pending);
    const toSpawn = Math.max(0, data.toSpawn);

    this.zombieCount.set(active);
    this.zombieTotal.set(totalLeft);
    this.waveTotal.set(waveSize);
    this.zombieDebugText.set(`A:${active} L:${loading} P:${pending} Q:${toSpawn}`);
    
    if (isWaveStartSpawn) {
      this.zombieText.set(`Spawning... 0 / ${totalLeft}`);
    } else {
      // Format: in-world alive / total left in this wave.
      // Example at high waves: 15 / 30, then 14 / 29, then back to 15 / 29.
      this.zombieText.set(`Zombies: ${active} / ${totalLeft}`);
    }
    
    // Progress bar shows zombies left vs wave total
    this.zombiePercent.set(Math.max(0, Math.min(1, totalLeft / waveSize)));
  }

  // ---------------------------------------------------------
  // JOIN NOTIFICATION
  // ---------------------------------------------------------
  onPlayerJoined(data: { name: string }) {
    this.joinMsg.set(`${data.name}\nJoined the Game!`);
    this.joinMsgVisible.set(true);
    this.async.setTimeout(() => {
      this.joinMsgVisible.set(false);
    }, 4000);
  }

  // ---------------------------------------------------------
  // HEADSHOT INDICATOR
  // ---------------------------------------------------------
  // Now called via LocalBroadCast - MUST use player scope
  onPlayerHeadshot(player: hz.Player) {
    if (!player || !player.isValidReference.get()) return;
    
    // Determine multiplier based on wave
    const currentWave = this.currentWave;
    let mult = '2x';
    if (currentWave >= 8) {
      mult = '4x';
    } else if (currentWave >= 4) {
      mult = '3x';
    }
    
    // Show headshot indicator (Scoped to player)
    this.headshotMultiplier.set(mult, [player]);
    this.headshotVisible.set(true, [player]);
    this.headshotOpacity.set(1, [player]); // Make visible
    
    // Pop animation
    this.headshotScale.set(1.5, [player]);
    this.async.setTimeout(() => {
      if (player.isValidReference.get()) {
        this.headshotScale.set(1.0, [player]);
      }
    }, 100);
    
    // Hide after 1 second
    this.async.setTimeout(() => {
      if (player.isValidReference.get()) {
        this.headshotVisible.set(false, [player]);
        this.headshotOpacity.set(0, [player]); // Hide
      }
    }, 1000);
  }

  // ---------------------------------------------------------
  // PROXIMITY WARNING SYSTEM (Forward to Sub-Component)
  // ---------------------------------------------------------
  
  /**
   * Gets the local player safely, with fallback for script reload scenarios.
   * Made public-ish (available to sub-components via 'this')
   */
  private _cachedLocalPlayer: hz.Player | null = null;

  getLocalPlayer(): hz.Player | null {
    if (this._cachedLocalPlayer && this._cachedLocalPlayer.isValidReference.get()) {
        return this._cachedLocalPlayer;
    }

    const localPlayer = this.world.getLocalPlayer();
    if (localPlayer && localPlayer.isValidReference.get()) {
        this._cachedLocalPlayer = localPlayer;
        return localPlayer;
    }
    return null;
  }

  /**
   * Handles zombie proximity events.
   * DELEGATED to HUD_ProximitySensor.ts
   */
  onZombieProximity(data: { dist: number, pos: { x: number, y: number, z: number }, id?: string, targetId?: string }) {
      // SERVER-SIDE PLAYER RESOLUTION
      if (!data.targetId) return;

      const playerId = Number(data.targetId);
      const player = Number.isNaN(playerId)
        ? null
        : (playerLookupMap.get(playerId) ?? this.world.getPlayers().find(p => p.id === playerId) ?? null);
      if (player) {
           this.proximitySensor.onZombieProximity(data, player);
      }
  }

  // ---------------------------------------------------------
  // ROOT UI
  // ---------------------------------------------------------
  initializeUI(): ui.UINode {
    // FIX: Initialize sensor here just in case initUI runs first
    if (!this.proximitySensor) this.proximitySensor = new HUD_ProximitySensor(this);
    if (!this.killFeed) this.killFeed = new HUD_KillFeed(this);
    if (!this.playerList) this.playerList = new HUD_PlayerList(this);
    if (!this.playerStats) this.playerStats = new HUD_PlayerStats(this);

    return ui.View({
      children: [
        this.damageOverlay(),
        this.playerList.createView(),
        this.healthView(),
        this.zombieCounterView(),
        this.ammoView(),
        this.killFeed.createKillCounterView(),
        this.waveView(),
        this.proximitySensor.createView(), // DELEGATED VIEW
        this.killFeed.createDeathNotificationView(),
        this.joinNotificationOverlay(),
        this.headshotIndicatorView(),
        this.comboIndicatorView(),
        this.playerStats.createView(),
        this.clockView(),
        this.gameEndingOverlay(),
      ],
      style: {
        width: '100%',
        height: '100%',
      }
    });
  }

  // Red flash overlay (Fixed to avoid nested Binding type error)
  damageOverlay() {
    return ui.View({
      children: [
        ui.View({
          style: {
            position: 'absolute', width: '100%', height: '100%',
            backgroundColor: this.damageAlpha.derive(a => `rgba(255, 0, 0, ${a})`)
          }
        }),
        ui.View({
          style: {
            position: 'absolute', width: '100%', height: '100%',
            backgroundColor: this.lowHealthAlpha.derive(a => `rgba(255, 0, 0, ${a})`)
          }
        })
      ],
      style: {
        position: 'absolute',
        width: '100%',
        height: '100%',
      }
    });
  }

  // =========================================================
  // HEALTH BAR UI
  // =========================================================
  healthView() {
    return ui.View({
      children: [this.bar(), this.heartImage()],
      style: {
        bottom: 0,
        left: '50%',
        layoutOrigin: [0.5, 0],
        width: '45%',
        height: 128,
        position: 'absolute',
      }
    });
  }

  heartImage() {
    return ui.Image({
      source: ui.ImageSource.fromTextureAsset(this.props.heart!),
      style: {
        width: 128,
        height: 128,
        position: 'absolute',
        left: 0
      }
    });
  }

  bar() {
    return ui.View({
      children: [this.healthBar()],
      style: {
        borderColor: '#d65959',
        backgroundColor: '#712f2f',
        borderWidth: 8,
        height: 64,
        marginLeft: 88,
        marginTop: 32,
        borderTopRightRadius: 32,
        borderBottomRightRadius: 32
      }
    });
  }

  healthBar() {
    return ui.View({
      style: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
      },
      children: [
        ui.View({
          style: {
            position: 'absolute',
            height: '100%',
            left: 0,
            borderTopRightRadius: 24,
            borderBottomRightRadius: 24,
            width: this.health.derive(h => {
              const pct = Math.max(0, Math.min(100, h * 5));
              const step = Math.round(pct / 5) * 5;
              return `${step}%`;
            }),
            backgroundColor: this.health.derive(h => {
              const pct = Math.max(0, Math.min(100, h * 5));
              if (pct > 75) return '#55ff55';
              if (pct > 50) return '#d4ff55';
              if (pct > 30) return '#ffcc55';
              if (pct > 15) return '#ff8844';
              return '#ff4444';
            }),
          }
        }),
        ui.Text({
          text: this.health.derive(h => `${Math.max(0, Math.min(100, Math.round(h * 5)))}%`),
          style: {
            position: 'absolute', width: '100%', textAlign: 'center', fontSize: 32,
            fontFamily: 'Roboto-Mono', color: '#000000',
            textShadowColor: '#000000', textShadowOffset: [2, 2], textShadowRadius: 4,
          }
        }),
        ui.Text({
          text: this.health.derive(h => `${Math.max(0, Math.min(100, Math.round(h * 5)))}%`),
          style: {
            position: 'absolute', width: '100%', textAlign: 'center', fontSize: 32,
            fontFamily: 'Roboto-Mono', color: '#ffffff',
            textShadowColor: '#000000', textShadowOffset: [1, 1], textShadowRadius: 3,
          }
        }),
      ]
    });
  }

  // =========================================================
  // AMMO UI
  // =========================================================
  ammoView() {
    return ui.View({
      children: [this.ammoBarContainer(), this.ammoNumbers()],
      style: {
        position: 'absolute', right: 32, bottom: 0, height: 128, width: 220, flexDirection: 'column',
        justifyContent: 'flex-end',
      }
    });
  }

  ammoBarContainer() {
    return ui.View({
      children: [this.ammoBarFill(), this.ammoBarText()],
      style: {
        width: '100%', height: 32, backgroundColor: '#2a2a2a',
        borderColor: '#6b6b6b', borderWidth: 4, borderRadius: 8,
        marginBottom: 4, position: 'relative',
      }
    });
  }

  ammoBarFill() {
    return ui.View({
      style: {
        position: 'absolute', height: '100%', left: 0, borderRadius: 6,
        width: this.ammoWidth,
        backgroundColor: this.magAmmo.derive(m => {
          if (m <= 5) return '#ff4444';
          if (m <= 10) return '#ffcc55';
          return '#3ea2ff';
        }), 
      }
    });
  }

  ammoBarText() {
    return ui.Text({
      text: this.magAmmo.derive(m => `${m}`),
      style: {
        position: 'absolute', width: '100%', height: '100%', textAlign: 'center',
        fontSize: 20, fontFamily: 'Roboto-Mono', color: '#ffffff',
        textShadowColor: '#000000', textShadowOffset: [1, 1], textShadowRadius: 3,
        justifyContent: 'center', alignItems: 'center',
      }
    });
  }

  ammoNumbers() {
    return ui.View({
      children: [
        ui.Text({
          text: '⌖', // Tactical Crosshair (looks much less "childish" than the water gun)
          style: { fontSize: 38, marginRight: 8, color: '#ffcc00' } // Slightly larger, gold/yellow
        }),
        ui.Text({
          text: this.magAmmo.derive(m => `${m}`),
          style: { fontSize: 48, fontFamily: 'Roboto-Mono', color: hz.Color.white, textAlign: 'left' }
        }),
        ui.Text({
          text: this.totalAmmo.derive(t => `${t}`),
          style: { fontSize: 32, fontFamily: 'Roboto-Mono', color: hz.Color.white, marginLeft: 8, textAlign: 'left' }
        }),
        ui.Text({
            text: this.magAmmo.derive(m => m <= 5 ? 'LOW AMMO' : ''),
            style: { 
                fontSize: 24, 
                color: '#ff4444', 
                marginLeft: 16, 
                fontWeight: 'bold',
                fontFamily: 'Roboto-Mono'
            }
        })
      ],
      style: { flexDirection: 'row', alignItems: 'center' }
    });
  }

  // =========================================================
  // WAVE UI
  // =========================================================
  waveView() {
    return ui.View({
      children: [
        ui.Text({
          text: 'WAVE',
          style: {
            fontSize: 13, textAlign: 'center', color: '#00e5ff',
            fontFamily: 'Roboto-Mono', fontWeight: 'bold', letterSpacing: 3,
            marginBottom: -8,
          }
        }),
        ui.Text({
          text: this.wave.derive(w => `${w}`),
          style: {
            fontSize: 60, textAlign: 'center',
            fontFamily: 'Roboto-Mono', color: '#ffffff', fontWeight: 'bold',
            textShadowColor: '#00e5ff', textShadowOffset: [0, 0], textShadowRadius: 10,
            transform: [{ scale: this.waveScale }],
          }
        })
      ],
      style: {
        position: 'absolute', left: '50%', top: 8,
        layoutOrigin: [0.5, 0],
        flexDirection: 'column', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderRadius: 12, borderWidth: 2, borderColor: '#00e5ff',
        paddingTop: 8, paddingBottom: 10, paddingLeft: 20, paddingRight: 20,
      }
    });
  }

  // =========================================================
  // ZOMBIE COUNTER UI
  // =========================================================
  zombieCounterView() {
     return ui.View({
       style: {
         position: 'absolute', top: 8, right: 20,
         padding: 12, backgroundColor: 'rgba(0,0,0,0.75)',
         borderRadius: 10, borderWidth: 2, borderColor: '#ff4444',
         flexDirection: 'column', alignItems: 'flex-end'
       },
        children: [
          ui.Text({
            text: this.zombieText,
            style: { fontSize: 24, fontFamily: 'Roboto-Mono', color: '#ff4444', fontWeight: 'bold' }
          }),
         ui.View({
             style: {
                 width: 150, height: 8, backgroundColor: '#333', marginTop: 4, borderRadius: 4
             },
             children: [
                 ui.View({
                     style: {
                         height: '100%', borderRadius: 4,
                         width: this.zombiePercent.derive(p => `${p * 100}%`),
                         backgroundColor: '#ff4444'
                     }
                 })
              ]
          }),
          ui.Text({
            text: this.zombieDebugText,
            style: {
              fontSize: 11,
              fontFamily: 'Roboto-Mono',
              color: '#aaaaaa',
              marginTop: 6,
            }
          })
        ]
     });
  }

  // =========================================================
  // COMBO INDICATOR UI
  // =========================================================
  comboIndicatorView() {
      return ui.View({
          style: {
              position: 'absolute', top: 250, right: 100,
              width: 300, height: 100,
              justifyContent: 'center', alignItems: 'center',
              display: this.comboVisible.derive(v => v ? 'flex' : 'none'),
              transform: [{ scale: this.comboScale }]
          },
          children: [
              ui.Text({
                  text: this.comboText,
                  style: {
                      fontSize: 42,
                      fontFamily: 'Roboto-Mono',
                      fontWeight: 'bold',
                      color: '#ffcc00', // Gold
                      textAlign: 'center',
                      textShadowColor: '#000', textShadowOffset: [3, 3], textShadowRadius: 0
                  }
              })
          ]
      });
  }

  // =========================================================
  // HEADSHOT INDICATOR UI
  // =========================================================
  headshotIndicatorView() {
    return ui.View({
      style: {
        position: 'absolute',
        top: '40%', left: '50%', 
        width: 400, height: 100,
        layoutOrigin: [0.5, 0.5],
        justifyContent: 'center', alignItems: 'center',
        display: this.headshotVisible.derive(visible => visible ? 'flex' : 'none'),
        opacity: this.headshotOpacity, 
        transform: [{ scale: this.headshotScale }]
      },
      children: [
        ui.Text({
          text: 'HEADSHOT!',
          style: { 
            fontSize: 48, color: '#ff3333', fontWeight: 'bold', 
            fontFamily: 'Roboto-Mono',
            textShadowColor: '#000000', textShadowOffset: [2, 2], textShadowRadius: 0
          }
        }),
        ui.Text({
          text: this.headshotMultiplier,
          style: { 
            fontSize: 36, color: '#ffff00', fontWeight: 'bold', 
            fontFamily: 'Roboto-Mono', marginTop: -10,
            textShadowColor: '#000000', textShadowOffset: [2, 2], textShadowRadius: 0
          }
        })
      ]
    });
  }

  // =========================================================
  // GAME ENDING OVERLAY
  // =========================================================
  gameEndingOverlay() {
    return ui.View({
      style: {
        position: 'absolute', width: '100%', height: '100%',
        justifyContent: 'center', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.8)',
        display: this.gameEndVisible.derive(visible => visible ? 'flex' : 'none'),
      },
      children: [
        ui.View({
          style: {
            width: 600, height: 300, backgroundColor: '#222', borderRadius: 20,
            justifyContent: 'center', alignItems: 'center',
            borderColor: '#ff4444', borderWidth: 4,
          },
          children: [
            ui.Text({
              text: 'GAME ENDING IN...',
              style: { fontSize: 40, color: '#fff', fontFamily: 'Roboto-Mono', marginBottom: 20 }
            }),
            ui.Text({
              text: this.gameEndTimer.derive(t => `${Math.max(0, t)}s`),
              style: { fontSize: 80, color: '#ff4444', fontFamily: 'Roboto-Mono', fontWeight: 'bold' }
            }),
            ui.Text({
              text: this.gameEndTriggeredBy.derive(n => `Triggered by: ${n}`),
              style: { fontSize: 24, color: '#aaa', fontFamily: 'Roboto-Mono', marginTop: 20 }
            }),
          ]
        })
      ]
    });
  }

  // =========================================================
  // LOCAL CLOCK UI
  // =========================================================
  clockView() {
    return ui.View({
      style: {
        position: 'absolute',
        bottom: 140,
        right: 28,
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#00e5ff',
        paddingTop: 6, paddingBottom: 6, paddingLeft: 14, paddingRight: 14,
      },
      children: [
        // Label
        ui.Text({
          text: '🕐 SERVER TIME',
          style: {
            fontSize: 11,
            fontFamily: 'Roboto-Mono',
            color: '#00e5ff',
            letterSpacing: 2,
            fontWeight: 'bold',
            marginBottom: 2,
          }
        }),
        // Time
        ui.Text({
          text: this.clockTime,
          style: {
            fontSize: 22,
            fontFamily: 'Roboto-Mono',
            fontWeight: 'bold',
            color: '#ffffff',
            textShadowColor: '#00e5ff',
            textShadowOffset: [0, 0],
            textShadowRadius: 6,
          }
        })
      ]
    });
  }

  // =========================================================
  // JOIN NOTIFICATION UI
  // =========================================================
  joinNotificationOverlay() {
    return ui.View({
      style: {
        position: 'absolute', top: 120, width: '100%', alignItems: 'center',
        display: this.joinMsgVisible.derive(v => v ? 'flex' : 'none'),
      },
      children: [
        ui.View({
          style: {
            width: 500, height: 130, backgroundColor: 'rgba(0, 20, 40, 0.9)', 
            borderRadius: 15, borderColor: '#00ccff', borderWidth: 3,
            justifyContent: 'center', alignItems: 'center',
          },
          children: [
            ui.Text({
              text: this.joinMsg,
              style: {
                fontSize: 28, color: '#ffffff', fontFamily: 'Roboto-Mono',
                textAlign: 'center', fontWeight: 'bold'
              }
            })
          ]
        })
      ]
    });
  }

}

hz.Component.register(HUD);
