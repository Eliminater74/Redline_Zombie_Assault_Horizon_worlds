import * as hz from 'horizon/core';
import { Events } from 'Events';
import { zombieAttackSFXs, zombieDeathSFXs, zombieMoanSFXs, playZombieDeath, playZombieMoan, playZombieHit } from 'ZombieSoundManager';
import { GameConfig } from 'GameConfig';

import { alivePlayers, alivePlayerIds, playerHealthMap, ignoredPlayerIds, setAlivePlayers } from 'GameState';
import { PersistenceManager } from 'PersistenceManager';


class PlayerManager extends hz.Component<typeof PlayerManager> {
  static propsDefinition = {
    startButton: { type: hz.PropTypes.Entity },
    spawnPoint1: { type: hz.PropTypes.Entity },
    spawnPoint2: { type: hz.PropTypes.Entity },
    spawnPoint3: { type: hz.PropTypes.Entity },
    spawnPoint4: { type: hz.PropTypes.Entity },
    spawnPoint5: { type: hz.PropTypes.Entity },
    spawnPoint6: { type: hz.PropTypes.Entity },
    spawnPoint7: { type: hz.PropTypes.Entity },
    spawnPoint8: { type: hz.PropTypes.Entity },
    spawnPoint9: { type: hz.PropTypes.Entity },
    spawnPoint10: { type: hz.PropTypes.Entity },
    deadSpawn: { type: hz.PropTypes.Entity },
    lobbySpawn: { type: hz.PropTypes.Entity }, // New Lobby Spawn
    HUD: { type: hz.PropTypes.Entity },
    startText: { type: hz.PropTypes.Entity },
    welcomeText: { type: hz.PropTypes.Entity }, 
    
    // NOTE: All zombie sounds (attack, death, moan, hitSFX) moved to ZombieSoundManager
    
    // Quit trigger - players step on this to leave the game voluntarily
    quitTrigger: { type: hz.PropTypes.Entity },
  };

  // --- STATE ---
  private initialPlayers: hz.Player[] = [];
  private playerHealth = new Map<hz.Player, number>();
  private playerKills = new Map<number, number>(); // Track kills by ID
  private playerHeadshots = new Map<number, number>(); // Track headshots by ID
  private playerVisits = new Map<number, number>(); // Track visits by ID
  private playerHighestWave = new Map<number, number>(); // Track highest wave by ID
  // NOTE: Sound arrays now imported from ZombieSoundManager
  private aliveSpawnPoints: hz.Entity[] = []; // Array for random spawns
  
  private playing: boolean = false;
  private currentWave = 1; 
  private forceEndTimer: number | null = null;
  
  // PERSISTENCE KEYS (Managed by GameConfig)
  private get KILLS_KEY() { return GameConfig.KILLS_KEY; } 
  private get HEADSHOTS_KEY() { return GameConfig.HEADSHOTS_KEY; }

  // AFK DETECTION
  // private afkExemptUsers removed - use GameConfig.MODERATOR_LIST instead
  private playerLastPos = new Map<number, hz.Vec3>();
  private playerLastRot = new Map<number, hz.Quaternion>(); // Track rotation too
  private playerIdleTime = new Map<number, number>();
  private afkCheckTimer: number | null = null;
  private playerListTimer: number | null = null;

  // COMBO SYSTEM (Restored)
  private playerLastKillTime = new Map<number, number>();
  private playerComboCount = new Map<number, number>();

  private isServer(): boolean {
    return this.entity.owner.get().id === this.world.getServerPlayer().id;
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in cleanup().
  cleanup(): void {
    if (this.forceEndTimer !== null) {
      this.async.clearInterval(this.forceEndTimer);
      this.forceEndTimer = null;
    }
    if (this.playerListTimer !== null) {
      this.async.clearInterval(this.playerListTimer);
      this.playerListTimer = null;
    }
  }

// ...
    // onWaveComplete removed (BestWaveTime leaderboard deleted)

  start(): void {
    const props = this.props;

    // NOTE: Sound arrays (attack, death, moan) now initialized by ZombieSoundManager

    // Init Spawn Points
    const spawns = [
      props.spawnPoint1, props.spawnPoint2, props.spawnPoint3, props.spawnPoint4, props.spawnPoint5,
      props.spawnPoint6, props.spawnPoint7, props.spawnPoint8, props.spawnPoint9, props.spawnPoint10
    ];
    this.aliveSpawnPoints = spawns.filter((s): s is hz.Entity => !!s);

    if (this.isServer()) {
        this.initialPlayers = this.world.getPlayers();
        this.startPlayerListBroadcast();
    }
    
    this.setupEvents();
  }

  private setupEvents() {
    if (this.props.startButton) {
      this.connectCodeBlockEvent(
        this.props.startButton,
        hz.CodeBlockEvents.OnPlayerEnterTrigger,
        (player: hz.Player) => {
             // Any player hitting start triggers game for everyone on platform
             this.sendNetworkBroadcastEvent(Events.requestStart, {});
        }
      );
    }

    this.connectNetworkBroadcastEvent(Events.requestStart, this.onRequestStart.bind(this));
    this.connectNetworkBroadcastEvent(Events.requestGameReset, this.onRequestGameReset.bind(this));
    this.connectNetworkBroadcastEvent(Events.startGame, this.onStartGame.bind(this));
    
    this.connectLocalBroadcastEvent(Events.hitPlayer, this.hitPlayer.bind(this));
    this.connectLocalBroadcastEvent(Events.attackSFX, this.attackSFX.bind(this));
    this.connectLocalBroadcastEvent(Events.newWave, this.newWave.bind(this));
    this.connectLocalBroadcastEvent(Events.healPlayer, this.healPlayer.bind(this));
    
    this.connectNetworkBroadcastEvent(Events.syncState, this.onSyncState.bind(this));

    // NEW: Listen for zombie deaths to track kills
    this.connectNetworkBroadcastEvent(Events.zombieDeath, this.onZombieDeath.bind(this));
    
    // NEW: Listen for AFK Watchdog kill commands
    this.connectNetworkBroadcastEvent(Events.killPlayer, this.onKillPlayerCommand.bind(this));

    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterWorld, this.playerEnter.bind(this));
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerExitWorld, this.playerExit.bind(this));

    this.connectNetworkBroadcastEvent(Events.requestForceEnd, this.onRequestForceEnd.bind(this));
    
    // NEW: Listen for Headshots
    this.connectLocalBroadcastEvent(Events.playerHeadshot, this.onPlayerHeadshot.bind(this));
    
    // NEW: Listen for zombie moans (ambient sounds)
    this.connectLocalBroadcastEvent(Events.zombieMoan, this.onZombieMoan.bind(this));
    
    // NEW: Quit trigger - allows players to leave game voluntarily
    if (this.props.quitTrigger) {
        this.connectCodeBlockEvent(
            this.props.quitTrigger,
            hz.CodeBlockEvents.OnPlayerEnterTrigger,
            (player: hz.Player) => this.onPlayerQuit(player)
        );
    }
    
    // NEW: Listen for welcome message to capture visit count
    this.connectNetworkBroadcastEvent(Events.showWelcome, this.onShowWelcome.bind(this));
  }

  // --- ZOMBIE MOAN (Ambient Sounds) ---
  // OPTIMIZATION: Only play if zombie is within hearing range (50m)
  // NOTE: Uses imported zombieMoanSFXs from ZombieSoundManager
  onZombieMoan(data: { pos: hz.Vec3 }) {
    if (zombieMoanSFXs.length === 0) return;
    
    // AUDIO CULLING: Skip sounds from very distant zombies to reduce audio load
    try {
      const localPlayer = this.world.getLocalPlayer();
      if (localPlayer) {
        const playerPos = localPlayer.position.get();
        // HORIZON BUG WORKAROUND: Vec3.distance()/distanceSquared() broken in HW — use manual dot product.
        const _mnDx = data.pos.x - playerPos.x, _mnDy = data.pos.y - playerPos.y, _mnDz = data.pos.z - playerPos.z;
        const dist = Math.sqrt(_mnDx * _mnDx + _mnDy * _mnDy + _mnDz * _mnDz);
        if (dist > 50) return; // Don't play sounds beyond 50 meters
      }
    } catch {
      // Player may have disconnected - play sound anyway
    }
    
    // Use imported helper function (handles random selection)
    playZombieMoan(data.pos);
  }

  // Capture visit count from the welcome message broadcast
  onShowWelcome(data: { playerId: number, name: string, visits: number }) {
    if (!this.isServer()) return;
    
    const player = this.world.getPlayers().find(p => p.id === data.playerId) ??
      this.world.getPlayers().find(p => p.name.get() === data.name);
    if (player) {
        this.playerVisits.set(player.id, data.visits);
        // Refresh stats display
        this.sendPlayerStats(player);
    }
  }

  // Sends all stats to the player's HUD
  sendPlayerStats(player: hz.Player) {
      if (!this.isServer()) return;

      const visits = this.playerVisits.get(player.id) ?? 1;
      const kills = this.playerKills.get(player.id) ?? 0;
      const headshots = this.playerHeadshots.get(player.id) ?? 0;
      const highestWave = this.playerHighestWave.get(player.id) ?? 0;

      // SYNC: Ensure Leaderboard reflects Persistence (Fixes blank boards after reset)
      // We use 'false' to only update if our local record is higher than the board's record
      if (highestWave > 0) {
          this.sendLocalBroadcastEvent(Events.updateLeaderboard, {
              player,
              stat: 'wave',
              value: highestWave
          });
          // this.world.leaderboards.setScoreForPlayer(GameConfig.LEADERBOARD_WAVE, player, highestWave, false);
      }

      // console.log(`[PlayerManager] Sending Stats to ${player.name.get()}: Visits=${visits}, Wave=${highestWave}, Kills=${kills}, HS=${headshots}`);

      this.sendNetworkEvent(player, Events.viewPlayerStats, {
          visits,
          highestWave,
          kills,
          headshots
      });
  }

  onZombieDeath(data: { zombie: hz.Entity, killer?: hz.Player }) {
      // 1. Play Sound (Run on Client & Server) - always play, don't check playing flag
      try {
          const pos = data.zombie?.position?.get() ?? hz.Vec3.zero;
          this.playDeathSound(pos);
      } catch (e) {
          // Fallback if position fails
          this.playDeathSound(hz.Vec3.zero);
      }

      if (!this.isServer()) return;
      if (!this.playing) return;
      
      if (!data.killer) return;

      // 1. Increment Kill Count
      const pid = data.killer.id;
      const currentKills = this.playerKills.get(pid) ?? 0;
      const newKills = currentKills + 1;
      this.playerKills.set(pid, newKills);
      
      // --- COMBO LOGIC (Restored from TEMP) ---
      const now = Date.now();
      const lastTime = this.playerLastKillTime.get(pid) ?? 0;
      let combo = this.playerComboCount.get(pid) ?? 0;
  
      // Check time since last kill (4 seconds window)
      if (now - lastTime < 4000) {
          combo++;
      } else {
          combo = 1; // Reset or start new
      }
  
      // Update tracking
      this.playerLastKillTime.set(pid, now);
      this.playerComboCount.set(pid, combo);
  
      // Calculate Multiplier (2x, 3x, 4x)
      let multiplier = 1;
      if (combo >= 7) {
          multiplier = 4;
      } else if (combo >= 4) {
          multiplier = 3;
      } else if (combo >= 2) {
          multiplier = 2;
      }
  
      // Send Combo Event to Player (Visuals)
      if (multiplier > 1) {
          this.sendNetworkEvent(data.killer, Events.playerCombo, { multiplier, count: combo });
      }
      
      // Reset AFK timer - player is actively playing!
      this.playerIdleTime.set(pid, 0);
      
      // 2. Notify HUD (Private update logic is on HUD, but we broadcast the event)
      this.sendNetworkBroadcastEvent(Events.updateKillCount, { 
          count: newKills, 
          player: data.killer 
      });

      // 3. Update "MostKills" Leaderboard AND Persistent Storage
      // 3. Update Persistence & Leaderboards via Manager
      PersistenceManager.saveKills(this.world, data.killer, newKills);
      
      // Update HUD Stats
      this.sendPlayerStats(data.killer);
  }

  onPlayerHeadshot(data: { player: hz.Player }) {
      if (!this.isServer()) return;
      if (!this.playing) return;

      const pid = data.player.id;
      const current = this.playerHeadshots.get(pid) ?? 0;
      const newCount = current + 1;
      this.playerHeadshots.set(pid, newCount);

      // Update Persistence & Leaderboards via Manager
      PersistenceManager.saveHeadshots(this.world, data.player, newCount);
      
      // Update HUD Stats
      this.sendPlayerStats(data.player);
  }

  onRequestStart() {
      if (!this.isServer()) return;
      if (this.playing) return;
      this.sendNetworkBroadcastEvent(Events.startGame, {});
  }

  onRequestGameReset(data: { playerName: string }) {
      if (!this.isServer()) return;

      if (this.forceEndTimer) {
          this.async.clearInterval(this.forceEndTimer);
          this.forceEndTimer = null;
      }

      if (this.playing) {
          this.sendNetworkBroadcastEvent(Events.playerDied, {
              name: `Game reset by ${data.playerName}`
          });
          this.endGame();
          this.async.setTimeout(() => {
              this.sendNetworkBroadcastEvent(Events.startGame, {});
          }, 300);
          return;
      }

      this.sendNetworkBroadcastEvent(Events.startGame, {});
  }

  onStartGame() {
    if (this.playing) return; 

    this.currentWave = 1;
    this.playing = true;
    
    // Reset Kills - REMOVED for Lifetime Kills
    // this.playerKills.clear();

    if (this.isServer()) {
        // Get all real players (excluding server player)
        const serverPlayerId = this.world.getServerPlayer().id;
        setAlivePlayers(this.world.getPlayers().filter(p => p.id !== serverPlayerId));
        alivePlayerIds.clear();
        playerHealthMap.clear();
        alivePlayers.forEach(p => {
            alivePlayerIds.add(p.id);
            playerHealthMap.set(p.id, 10); // Full health at game start
            // console.log(`[PlayerManager] Added to alivePlayers: ${p.name.get()} (ID: ${p.id})`);
        });
        // console.log(`[PlayerManager] Total alivePlayers: ${alivePlayers.length}`);
        this.initialPlayers = alivePlayers.slice(); // Copy the filtered array

        alivePlayers.forEach(player => {
            this.spawnPlayerAlive(player);
            // Do NOT reset HUD kills to 0, keep them as is (or refresh from map)
            const k = this.playerKills.get(player.id) ?? 0;
            this.sendNetworkBroadcastEvent(Events.updateKillCount, { count: k, player }); 
        });
        
        // this.startAFKCheck(); // Moved to AFKWatchdog.ts
    }

    this.updateText('Wait For Next Wave');
  }

  onSyncState(data: { wave: number, isPlaying: boolean }) {
      this.currentWave = data.wave;
      this.playing = data.isPlaying;

      if (this.playing) {
          this.updateText('Wait For Next Wave');
      }
  }

  spawnPlayerAlive(player: hz.Player) {
    if (this.aliveSpawnPoints.length > 0) {
        const rand = Math.floor(Math.random() * this.aliveSpawnPoints.length);
        this.aliveSpawnPoints[rand].as(hz.SpawnPointGizmo)?.teleportPlayer(player);
    }
    // this.props.aliveSpawn?.as(hz.SpawnPointGizmo)?.teleportPlayer(player); // Deprecated
    this.playerHealth.set(player, 20);
    playerHealthMap.set(player.id, 20);
    
    if (this.props.HUD) {
        this.sendNetworkEvent(this.props.HUD, Events.viewHealth, { health: 20, player });
    }
  }

  healPlayer(data: { amount: number; player: hz.Player }) {
    if (!this.playing) return;
    const hp = this.playerHealth.get(data.player);
    if (hp === undefined || hp <= 0) return; 
    const newHP = Math.min(20, hp + data.amount);
    this.playerHealth.set(data.player, newHP);
    playerHealthMap.set(data.player.id, newHP);
    if (this.props.HUD) this.sendNetworkEvent(this.props.HUD, Events.viewHealth, { health: newHP, player: data.player });
  }

  hitPlayer(data: { player: hz.Player; pos: hz.Vec3 }) {
    if (!this.playing) return; 
    const hp = this.playerHealth.get(data.player);
    if (hp === undefined) return;
    const newHP = hp - 1;
    this.playerHealth.set(data.player, newHP);
    playerHealthMap.set(data.player.id, newHP);
    if (this.props.HUD) this.sendNetworkEvent(this.props.HUD, Events.viewHealth, { health: newHP, player: data.player });
    // Play hit sound at player position
    playZombieHit(data.player.position.get());
    if (newHP <= 0) this.killPlayer(data.player);
  }

  onKillPlayerCommand(data: { player: hz.Player, reason?: string }) {
      if (!this.isServer()) return;
      
      // Handle Voluntary Quit (Redirect to Quit Logic)
      if (data.reason === "Quit Game") {
          this.onPlayerQuit(data.player);
          return;
      }
      
      // Validate player matches local reference or ID
      // (Simplified: just pass to killPlayer which handles cleanup)
      if (data.reason) {
           this.sendNetworkBroadcastEvent(Events.playerDied, { name: data.player.name.get() + " (" + data.reason + ")" });
      }
      this.killPlayer(data.player);
  }

  killPlayer(player: hz.Player) {
    this.props.deadSpawn?.as(hz.SpawnPointGizmo)?.teleportPlayer(player);
    
    // Notify everyone
    this.sendNetworkBroadcastEvent(Events.playerDied, { name: player.name.get() });

    setAlivePlayers(alivePlayers.filter(p => p.id !== player.id));
    alivePlayerIds.delete(player.id);
    this.playerHealth.delete(player);
    playerHealthMap.delete(player.id);
    this.checkForEnd();
  }

  // Player voluntarily leaves the game
  onPlayerQuit(player: hz.Player) {
    if (!this.playing) return;
    if (!alivePlayerIds.has(player.id)) return; // Already out of game
    
    // Teleport to lobby (not dead spawn)
    this.props.lobbySpawn?.as(hz.SpawnPointGizmo)?.teleportPlayer(player);
    
    // Notify with different message
    this.sendNetworkBroadcastEvent(Events.playerDied, { name: player.name.get() + " left the game" });
    
    // Remove from alive players
    setAlivePlayers(alivePlayers.filter(p => p.id !== player.id));
    alivePlayerIds.delete(player.id);
    this.playerHealth.delete(player);
    playerHealthMap.delete(player.id);
    this.checkForEnd();
  }

  onRequestForceEnd(data: { playerName: string }) {
      if (!this.isServer()) return;
      if (!this.playing) return;
      if (this.forceEndTimer) return; // Already ending

      // Broadcast to all clients to show UI
      this.sendNetworkBroadcastEvent(Events.gameEnding, { seconds: 10, triggeredBy: data.playerName });

      // Start server-side timer
      let secondsLeft = 10;
      this.forceEndTimer = this.async.setInterval(() => {
          secondsLeft--;
          if (secondsLeft <= 0) {
              if (this.forceEndTimer) {
                  this.async.clearInterval(this.forceEndTimer);
                  this.forceEndTimer = null;
              }
              this.endGame();
          }
      }, 1000);
  }

  checkForEnd() {
    if (alivePlayers.length <= 0 && this.playing) {
      this.endGame();
    }
  }

  endGame() {
    // this.stopAFKCheck(); // Moved to AFKWatchdog
    this.initialPlayers.forEach(player => {
        if (!player || !player.isValidReference.get()) return;

        // Upload Wave/Kill through centralized persistence layer
        PersistenceManager.saveWave(this.world, player, this.currentWave);
        const kills = this.playerKills.get(player.id) ?? 0;
        PersistenceManager.saveKills(this.world, player, kills);
        
        // Update local highest wave if NEW record
        const currentHigh = this.playerHighestWave.get(player.id) ?? 0;
        if (this.currentWave > currentHigh) {
            this.playerHighestWave.set(player.id, this.currentWave);
            this.sendPlayerStats(player);
        }
    });
    this.sendNetworkBroadcastEvent(Events.endGame, {});
    this.playing = false;

    if (this.forceEndTimer) {
        this.async.clearInterval(this.forceEndTimer);
        this.forceEndTimer = null;
    }

    this.updateText('Start Game');

    // Teleport all players to lobby
    if (this.props.lobbySpawn) {
        const spawnGizmo = this.props.lobbySpawn.as(hz.SpawnPointGizmo);
        if (spawnGizmo) {
             const allPlayers = this.world.getPlayers();
             allPlayers.forEach(p => spawnGizmo.teleportPlayer(p));
        }
    }
  }

  newWave(data: { wave: number }) {
    this.currentWave = data.wave;
    
    if (this.isServer()) {
        const serverPlayerId = this.world.getServerPlayer().id;
        
        // Only respawn players who were in the initial game but died
        this.initialPlayers.forEach(player => {
            if (player.id === serverPlayerId) return; // Skip server player
            
            if (!alivePlayerIds.has(player.id)) {
                // This player was in the game but died - respawn them
                this.spawnPlayerAlive(player);
                alivePlayers.push(player);
                alivePlayerIds.add(player.id);
            }
        });
    }
  }

  playerEnter(player: hz.Player) {
    player.sprintMultiplier.set(1);

    if (this.isServer()) {
        if (!this.initialPlayers.some(p => p.id === player.id)) {
             this.initialPlayers.push(player);
        }
        
        // Notify HUD of new player
        this.sendNetworkBroadcastEvent(Events.playerJoined, { name: player.name.get() });

        if (this.playing) {
            this.props.deadSpawn?.as(hz.SpawnPointGizmo)?.teleportPlayer(player);
            
            this.sendNetworkBroadcastEvent(Events.syncState, { 
                wave: this.currentWave, 
                isPlaying: true 
            });
        }
    }
    
    if (this.props.welcomeText) {
        const name = player.name.get();
        const textGizmo = this.props.welcomeText.as(hz.TextGizmo);
        if (textGizmo) {
            textGizmo.text.set(`Welcome,\n${name}!`);
            this.async.setTimeout(() => textGizmo.text.set(""), 5000);
        }
    }
    
    // LOAD LIFETIME KILLS (Server Side)
    if (this.isServer()) {
        try {
            // Use the full group:variable key format
            const savedKills = this.world.persistentStorage.getPlayerVariable<number>(player, this.KILLS_KEY);
            if (savedKills !== undefined && savedKills !== null) {
                this.playerKills.set(player.id, savedKills);
                
                // Update HUD for this player immediately
                this.async.setTimeout(() => {
                    this.sendNetworkBroadcastEvent(Events.updateKillCount, { 
                        count: savedKills, 
                        player: player 
                    });
                    
                    // FORCE SYNC: Upload to leaderboard immediately on join
                    this.sendLocalBroadcastEvent(Events.updateLeaderboard, {
                        player,
                        stat: 'kills',
                        value: savedKills
                    });
                }, 1000); 
            }
        } catch(e) { console.warn("Failed to load kills", e); }
        
        try {
            // Use the full group:variable key format
            const savedHeadshots = this.world.persistentStorage.getPlayerVariable<number>(player, this.HEADSHOTS_KEY);
            if (savedHeadshots !== undefined && savedHeadshots !== null) {
                this.playerHeadshots.set(player.id, savedHeadshots);
                
                // FORCE SYNC: Upload to leaderboard immediately on join
                this.async.setTimeout(() => {
                    this.sendLocalBroadcastEvent(Events.updateLeaderboard, {
                        player,
                        stat: 'headshots',
                        value: savedHeadshots
                    });
                }, 1200);
            }
        } catch(e) { console.warn("Failed to load headshots", e); }
        
        try {
            // Load Highest Wave
             const savedWave = this.world.persistentStorage.getPlayerVariable<number>(player, GameConfig.WAVE_KEY);
            if (savedWave !== undefined && savedWave !== null) {
                this.playerHighestWave.set(player.id, savedWave);
            }
        } catch(e) { console.warn("Failed to load wave", e); }
        
        // Send initial stats package
        this.async.setTimeout(() => {
            this.sendPlayerStats(player);
        }, 1500); // 1.5s delay to allow visits to load from WelcomeSign event
    }
  }

  playerExit(player: hz.Player) {
    if (!this.isServer()) return;

    // SAVE PROGRESS: Wave Leaderboard & Persistence
    try {
        PersistenceManager.saveWave(this.world, player, this.currentWave);
    } catch(e) { console.error("Failed to save on exit", e); }

    this.playerHealth.delete(player);
    this.playerKills.delete(player.id); // Clean up
    setAlivePlayers(alivePlayers.filter(p => p.id !== player.id));
    alivePlayerIds.delete(player.id);
    this.initialPlayers = this.initialPlayers.filter(p => p.id !== player.id);
    this.checkForEnd();
  }

  attackSFX(data: { pos: hz.Vec3 }) {
    // 1. Check distance to Local Player (Client-side spatialization)
    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) return;

    // HORIZON BUG WORKAROUND: distanceSquared() is available on Vec3 via the platform API here,
    // but using manual dot product for consistency with the rest of the codebase.
    const lp = localPlayer.position.get();
    const dx = lp.x - data.pos.x, dy = lp.y - data.pos.y, dz = lp.z - data.pos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    // HORIZON BUG WORKAROUND: Magic numbers — 400 = 20m squared (attack sound max range).
    const ATTACK_SOUND_RANGE_SQ = 400;
    if (distSq > ATTACK_SOUND_RANGE_SQ) return;

    // Use imported helper from ZombieSoundManager
    if (zombieAttackSFXs.length === 0) return;
    const sfx = zombieAttackSFXs[Math.floor(Math.random() * zombieAttackSFXs.length)];
    if (sfx) {
        sfx.position.set(data.pos);
        // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
        const attackAudio = sfx.as(hz.AudioGizmo);
        if (attackAudio) { attackAudio.stop(); attackAudio.play(); }
    }
  }

  playDeathSound(pos: hz.Vec3) {
      // Use imported helper from ZombieSoundManager
      playZombieDeath(pos);
  }

  updateText(msg: string) {
      this.props.startText?.as(hz.TextGizmo)?.text.set(msg);
  }

  // --- PLAYER LIST BROADCAST ---
  private startPlayerListBroadcast() {
    // Broadcast player list every 2 seconds
    this.playerListTimer = this.async.setInterval(() => {
      this.broadcastPlayerList();
    }, 2000);
    
    // Initial broadcast
    this.async.setTimeout(() => this.broadcastPlayerList(), 500);
  }

  private broadcastPlayerList() {
    if (!this.isServer()) return;
    
    const serverPlayerId = this.world.getServerPlayer().id;
    const allPlayers = this.world.getPlayers().filter(p => p.id !== serverPlayerId);
    
    const playerList: Array<{ name: string, status: string }> = [];
    
    for (const player of allPlayers) {
      const isInGame = alivePlayerIds.has(player.id);
      const isWaitingToRespawn = !isInGame && this.playing && this.initialPlayers.some(p => p.id === player.id);
      
      let status = 'Platform';
      if (isInGame) {
        status = 'Game';
      } else if (isWaitingToRespawn) {
        status = 'Dead';
      }
      
      playerList.push({ name: player.name.get(), status });
    }
    
    this.sendNetworkBroadcastEvent(Events.updatePlayerList, { players: playerList });
  }



  // --- AFK LOGIC MOVED TO AFKWatchdog.ts ---
}

hz.Component.register(PlayerManager);
