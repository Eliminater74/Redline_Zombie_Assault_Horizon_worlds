import * as hz from 'horizon/core';
import { AccessControl } from 'AccessControl';

/**
 * LOBBY SPAWN GUARD
 * Ensures players spawn on the lobby platform correctly.
 * 
 * Features:
 * 1. When player joins world, waits briefly then teleports to lobby spawn
 * 2. Supports 6 spawn points to handle multiple simultaneous joins
 * 3. Optional catch zone below platform - teleports fallen players back up
 * 4. Editors/Creators are NOT affected (can move freely)
 */
class LobbySpawnGuard extends hz.Component<typeof LobbySpawnGuard> {
  static propsDefinition = {
    // 6 spawn points on the floating lobby platform
    lobbySpawn1: { type: hz.PropTypes.Entity },
    lobbySpawn2: { type: hz.PropTypes.Entity },
    lobbySpawn3: { type: hz.PropTypes.Entity },
    lobbySpawn4: { type: hz.PropTypes.Entity },
    lobbySpawn5: { type: hz.PropTypes.Entity },
    lobbySpawn6: { type: hz.PropTypes.Entity },
    
    // Optional: A trigger zone BELOW the platform to catch fallen players
    catchZone: { type: hz.PropTypes.Entity },
    
    // Delay before teleporting (allows physics to settle)
    spawnDelay: { type: hz.PropTypes.Number, default: 1.5 },
  };

  //--------------------------------------------------
  // EDITORS/CREATORS - Now uses shared AccessControl module
  //--------------------------------------------------

  private lobbySpawns: hz.Entity[] = [];
  private spawnIndex = 0; // Round-robin counter

  start(): void {}

  preStart(): void {
    // Build list of available spawn points
    if (this.props.lobbySpawn1) this.lobbySpawns.push(this.props.lobbySpawn1);
    if (this.props.lobbySpawn2) this.lobbySpawns.push(this.props.lobbySpawn2);
    if (this.props.lobbySpawn3) this.lobbySpawns.push(this.props.lobbySpawn3);
    if (this.props.lobbySpawn4) this.lobbySpawns.push(this.props.lobbySpawn4);
    if (this.props.lobbySpawn5) this.lobbySpawns.push(this.props.lobbySpawn5);
    if (this.props.lobbySpawn6) this.lobbySpawns.push(this.props.lobbySpawn6);

    // 1. Teleport players to lobby when they join
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterWorld,
      (player: hz.Player) => this.onPlayerJoin(player)
    );

    // 2. Catch zone for fallen players
    if (this.props.catchZone) {
      this.connectCodeBlockEvent(
        this.props.catchZone,
        hz.CodeBlockEvents.OnPlayerEnterTrigger,
        (player: hz.Player) => this.rescuePlayer(player)
      );
    }
  }

  private isEditor(player: hz.Player): boolean {
    return AccessControl.hasAccess(player, this.entity);
  }

  private onPlayerJoin(player: hz.Player) {
    if (this.lobbySpawns.length === 0) return;
    if (this.isEditor(player)) return; // Editors can spawn anywhere
    
    // Wait for physics to settle, then teleport
    this.async.setTimeout(() => {
      this.teleportToLobby(player);
    }, (this.props.spawnDelay ?? 1.5) * 1000);
  }

  private rescuePlayer(player: hz.Player) {
    if (this.isEditor(player)) return; // Editors can go anywhere
    
    // Player fell into catch zone - teleport them back
    this.teleportToLobby(player);
  }

  private teleportToLobby(player: hz.Player) {
    if (this.lobbySpawns.length === 0) return;
    
    // Round-robin through spawn points to distribute players
    const spawn = this.lobbySpawns[this.spawnIndex % this.lobbySpawns.length];
    this.spawnIndex++;
    
    spawn?.as(hz.SpawnPointGizmo)?.teleportPlayer(player);
  }
}

hz.Component.register(LobbySpawnGuard);

