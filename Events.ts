import * as hz from 'horizon/core';

export const Events = {
  // --- ZOMBIE EVENTS ---
  queueZombie: new hz.LocalEvent<{ zombie: hz.Entity, health?: number, speed?: number, wave?: number }>('queueZombie'),
  reviveZombie: new hz.NetworkEvent<{ zombie: hz.Entity, health?: number, speed?: number, wave?: number, position?: hz.Vec3 }>('reviveZombie'),
  zombieDeath: new hz.NetworkEvent<{ zombie: hz.Entity, killer?: hz.Player, deathPos?: hz.Vec3, seq?: number }>('zombieDeath'),
  hitZombie: new hz.NetworkEvent<{ damage: number, instigator?: hz.Player, hitPos?: hz.Vec3, seq?: number }>('hitZombie'),
  zombieHitAnim: new hz.NetworkEvent<{ zombie: hz.Entity }>('zombieHitAnim'),
  attackSFX: new hz.NetworkEvent<{ pos: hz.Vec3 }>('attackSFX'),
  playerHeadshot: new hz.LocalEvent<{ player: hz.Player }>("playerHeadshot"), // Server-side notification
  playerCombo: new hz.NetworkEvent<{ multiplier: number, count: number }>('playerCombo'), // Targeted to specific player
  
  // OPTIMIZATION: Targeted Network Event
  // Only the targeted player receives proximity alerts.
  zombieProximity: new hz.LocalEvent<{ dist: number, pos: hz.Vec3, id: string, targetId: string }>('zombieProximity'),
  
  // --- VISUAL FX EVENTS ---
  initFloatingDamage: new hz.NetworkEvent<{ amount: number, isHeadshot: boolean }>('initFloatingDamage'),

  // --- ZOMBIE AI EVENTS ---
  gunshot: new hz.NetworkEvent<{ pos: hz.Vec3, seq?: number }>('gunshot'), // Sound awareness for zombies (Network so client->server works)
  zombieMoan: new hz.LocalEvent<{ pos: hz.Vec3 }>('zombieMoan'), // Random zombie ambient sounds

  // --- GAME LOOP EVENTS ---
  
  // 1. SAFE START (Client asks, Server decides)
  requestStart: new hz.NetworkEvent<{}>('requestStart'),

  // 2. ACTUAL START (Server tells everyone to go)
  startGame: new hz.NetworkEvent<{}>('startGame'),

  endGame: new hz.NetworkEvent<{}>('endGame'),
  newWave: new hz.LocalEvent<{ wave: number }>('newWave'),
  waveComplete: new hz.NetworkEvent<{ wave: number, duration: number }>('waveComplete'),
  ghostHunt: new hz.NetworkEvent<{ enabled: boolean }>('ghostHunt'), // Reveals stuck zombies

  // --- ZOMBIE COUNTER ---
  updateZombieCount: new hz.NetworkEvent<{
    count: number,
    total: number,
    waveTotal: number,
    remaining: number,
    loading: number,
    pending: number,
    toSpawn: number
  }>('updateZombieCount'),
  
  // --- KILL COUNTER ---
  updateKillCount: new hz.NetworkEvent<{ count: number, player: hz.Player }>('updateKillCount'),

  // 3. LATE JOINER SYNC (Server tells new player current stats)
  syncState: new hz.NetworkEvent<{ wave: number, isPlaying: boolean }>('syncState'),

  // --- PLAYER EVENTS ---
  hitPlayer: new hz.LocalEvent<{ player: hz.Player, pos: hz.Vec3 }>('hitPlayer'),
  giveAmmo: new hz.NetworkEvent<{}>('giveAmmo'),
  ammoPickedUp: new hz.LocalEvent<{ player: hz.Player }>('ammoPickedUp'),
  
  // NEW: Reliable Initialization
  requestWeaponInit: new hz.NetworkEvent<{ requestor: hz.Player }>('requestWeaponInit'), // Client -> Server handshake
  initializeWeapon: new hz.NetworkEvent<{ player: hz.Player }>('initializeWeapon'),
  despawnAmmo: new hz.NetworkEvent<{ id: string }>('despawnAmmo'), // FIX: Server-side cleanup request
  forceCleanupAmmo: new hz.NetworkEvent<{ keepCount: number }>('forceCleanupAmmo'), // FIX: Broadcast to purge invisible/collected ammo
  healPlayer: new hz.LocalEvent<{ amount: number, player: hz.Player }>('healPlayer'),
  killPlayer: new hz.NetworkEvent<{ player: hz.Player, reason?: string }>('killPlayer'), // Command to kill a player
  playerDied: new hz.NetworkEvent<{ name: string }>('playerDied'),
  playerJoined: new hz.NetworkEvent<{ name: string }>('playerJoined'),

  // --- UI EVENTS ---
  viewAmmo: new hz.NetworkEvent<{
    ammo: number;
    totalAmmo: number;
    maxMag?: number;
    player?: hz.Player;
  }>('viewAmmo'),

  viewHealth: new hz.NetworkEvent<{ health: number, player: hz.Player }>('viewHealth'),
  viewWave: new hz.NetworkEvent<{ wave: number }>('viewWave'),
  
  // STATS PANEL EVENT
  viewPlayerStats: new hz.NetworkEvent<{
    visits: number,
    highestWave: number,
    kills: number,
    headshots: number,
    ammo: number,
  }>('viewPlayerStats'),
  

  
  // --- END GAME EVENTS ---
  requestForceEnd: new hz.NetworkEvent<{ playerName: string }>('requestForceEnd'),
  gameEnding: new hz.NetworkEvent<{ seconds: number, triggeredBy: string }>('gameEnding'),

  // --- WELCOME EVENT ---
  showWelcome: new hz.NetworkEvent<{ playerId: number, name: string, visits: number }>('showWelcome'),

  // --- GAME DOCTOR EVENTS ---
  requestStatus: new hz.NetworkEvent<{}>('requestStatus'),
  statusReport: new hz.NetworkEvent<{ 
      wave: number, 
      zombies: number, 
      total: number, 
      isSpawning: boolean, 
      uptime: number 
  }>('statusReport'),

  // --- PLAYER LIST EVENTS ---
  updatePlayerList: new hz.NetworkEvent<{ 
      players: Array<{ name: string, status: string }> 
  }>('updatePlayerList'),

  // --- LEADERBOARD EVENTS ---
  updateLeaderboard: new hz.LocalEvent<{
      player: hz.Player,
      stat: 'kills' | 'headshots' | 'wave' | 'level' | 'ammo',
      value: number
  }>('updateLeaderboard'),

  // --- LEVEL SYSTEM EVENTS ---
  xpGain: new hz.NetworkEvent<{
      amount: number,
      reason: string,
      totalXP: number,
      level: number,
      progress: number
  }>('xpGain'),

  levelUp: new hz.NetworkEvent<{
      oldLevel: number,
      newLevel: number,
      totalXP: number
  }>('levelUp'),

  levelSync: new hz.NetworkEvent<{
      level: number,
      totalXP: number,
      progress: number,
      xpToNext: number
  }>('levelSync'),

  // --- GAME ADMIN EVENTS ---
  requestGameReset: new hz.NetworkEvent<{ playerName: string }>('requestGameReset'),
  requestWaveReset: new hz.NetworkEvent<{}>('requestWaveReset'),
  requestWaveSkip: new hz.NetworkEvent<{}>('requestWaveSkip'),
};
