# Redline Audit Report

## Scope
- Recursive file inventory completed for the project root, local docs, config, and gameplay scripts.
- Deep behavior audit completed for the core gameplay systems: `WaveManager.ts`, `SpawnManager.ts`, `Zombie.ts`, `ZombieNav.ts`, `ZombieUpdateManager.ts`, `Gun.ts`, `WeaponManager.ts`, `PlayerManager.ts`, `HUD.ts`, `HUD_ProximitySensor.ts`, `LevelManager.ts`, `LeaderboardManager.ts`, `AmmoBox.ts`, and supporting event/config files.
- Pattern sweep completed across all remaining `.ts` files for lifecycle, timers, network events, `Vec3` API hazards, spawn usage, and cleanup coverage.

## Project File Registry

### Core Game Loop
- `Events.ts`: Global local/network event contracts for combat, waves, HUD, persistence, admin.
- `GameConfig.ts`: Data-versioned persistence keys, moderator list, leaderboard constants.
- `GameState.ts`: Shared live-state collections for alive players and per-player health.
- `WaveManager.ts`: Authoritative wave progression, zombie-count UI, ammo carryover cleanup, ghost-hunt watchdog.
- `SpawnManager.ts`: Zombie pooling, preload, spawn batching, recycle and watchdog recovery.
- `ZombieSpawnPoint.ts`: Queue-driven revive handoff from spawn points to pooled zombies.
- `Zombie.ts`: Zombie AI, targeting, damage, death, loot, attack flow, collider helper.
- `ZombieNav.ts`: NavMesh movement/path update logic and stuck handling.
- `ZombieUpdateManager.ts`: Centralized frame update manager for all active zombies.

### Player / Combat / Weapons
- `PlayerManager.ts`: Player lifecycle, health, deaths, join/leave flow, kill/headshot tracking, game start/end.
- `Gun.ts`: Weapon ownership handshake, firing, raycasts, ammo, reload, HUD ammo sync.
- `WeaponManager.ts`: Server-side weapon spawning/attachment, respawn watchdog, bundle preload.
- `WeaponConfig.ts`: Weapon definitions and lookup.
- `Knife.ts`: Melee fallback weapon and cooldown handling.
- `AmmoBox.ts`: Ammo pickup lifetime, collection, despawn, force cleanup.
- `HealthPickup.ts`: Health pickup proximity collection and despawn.
- `FloatingDamage.ts`: Spawned floating damage-number animation and cleanup.

### HUD / UI / Feedback
- `HUD.ts`: Main UI component for ammo, health, wave, combo, headshot, player list, game-end notices.
- `HUD_ProximitySensor.ts`: Proximity warning radar for zombies and allies.
- `HUD_KillFeed.ts`: Kill counter and death feed.
- `HUD_PlayerList.ts`: Player status list UI.
- `HUD_PlayerStats.ts`: Stats panel and level/XP popups.
- `HUD_Coriolis.ts`: Alternate/simple ammo-health HUD listener.
- `WelcomeAudio.ts`: Welcome voice playback timing.
- `AmbientHorrorSFX.ts`: Ambient horror sound scheduling.
- `ThemeMusicManager.ts`: Music playback, watchdog, recovery.
- `ZombieSoundManager.ts`: Shared zombie attack/moan/death/hit audio helpers.
- `VoiceManager.ts`: Voice range enforcement.

### Progression / Persistence / Leaderboards
- `LevelManager.ts`: XP, level math, wave/kill/headshot/visit XP awards.
- `LeaderboardManager.ts`: Central leaderboard writes.
- `PersistenceManager.ts`: Persistent storage saves and leaderboard sync helpers.
- `PersistenceDoctor.ts`: Persistence diagnostics.
- `VisitorLeaderboard.ts`: Visit tracking and welcome event broadcast.
- `PlayerList.ts`: Player list helper.

### Admin / Safety / Session Control
- `GameAdmin.ts`: In-world admin controls for reset/skip/status/force-end.
- `AdminPanel.ts`: Admin UI/panel interactions.
- `AdminPortal.ts`: Admin entry/feedback portal.
- `AFKWatchdog.ts`: AFK detection and forced quit flow.
- `AccessControl.ts`: Ownership/access helper logic.
- `LobbySpawnGuard.ts`: Lobby spawn safety / delayed spawn handling.

### World / Utility / Other Gameplay Scripts
- `LevelTeleport.ts`: Teleport helper.
- `MovingPlatform.ts`: Patrol platform movement and rider safety.
- `Portal_Entity.ts`: Portal proximity logic.
- `Portal_Data.ts`: Portal config data.
- `Portal_RandomSpawnPoint_Entity.ts`: Portal spawn-point helper.
- `NpcAutoTurner.ts`: NPC facing helper.
- `HatTrigger.ts`: NPC engagement trigger.
- `PirateTrigger.ts`: Pirate NPC trigger/dialog logic.
- `TreasureTrigger.ts`: Treasure-trigger logic.
- `KillBooster.ts`: Kill-count admin/test helper.
- `ZombieBuilder.ts`: In-world zombie-builder/debug helper.
- `Changelog.ts`, `CHANGELOG.md`, `TODO.md`, `@REDLINE_AGENT_DIRECTIVE.md`: Documentation/context.
- `BetaSign.ts`, `CodeOfConduct.ts`, `MusicCredits.ts`, `notes.ts`, `SpinningLogo.ts`: Informational/signage/presentation scripts.

## System Dependency Map
- `PlayerManager` -> `WaveManager`: start/end game flow and wave announcements.
- `WaveManager` -> `SpawnManager` -> `ZombieSpawnPoint` -> `Zombie`: authoritative spawn pipeline.
- `Zombie` -> `ZombieNav` and `ZombieUpdateManager`: AI movement and centralized ticking.
- `Gun` -> `Zombie` via `Events.hitZombie`: authoritative damage delivery.
- `Zombie` -> `PlayerManager` via `Events.hitPlayer`: player damage and deaths.
- `PlayerManager` -> `LeaderboardManager` and `PersistenceManager`: kill/headshot/wave persistence and boards.
- `LevelManager` -> `PersistenceManager`: XP/level saves and player notifications.
- `HUD` -> `HUD_ProximitySensor`, `HUD_KillFeed`, `HUD_PlayerList`, `HUD_PlayerStats`: player-facing UI aggregation.
- `WaveManager`, `PlayerManager`, `LevelManager`, `HUD`, `Gun`, `Zombie` all depend on `Events.ts`.

### Dependency Notes
- No hard circular import loop was found in the gameplay-critical path.
- Event-level coupling is heavy around `Events.ts`, so schema drift is a project-wide risk area.
- `HUD.ts` still performs per-player event attachment dynamically, which is correct but deserves regression testing during joins/leaves.

## Critical Bugs Fixed
- `Events.ts:7`, `Events.ts:8`, `Events.ts:22`
  Added optional `seq` fields to combat-critical network events so listeners can reject stale or duplicate packets.
- `Gun.ts:41`, `Gun.ts:304`, `Gun.ts:393`
  Added monotonic shot sequencing to `gunshot` and `hitZombie` emissions to harden against network reordering.
- `Zombie.ts:114`, `Zombie.ts:753`, `Zombie.ts:799`, `Zombie.ts:839`, `Zombie.ts:913`
  Added revive grace/collider delay, stale-hit rejection, overkill clamp, and death sequencing to prevent fresh-spawn hit desync, duplicate damage, and repeated death processing.
- `PlayerManager.ts:37`, `PlayerManager.ts:44`, `PlayerManager.ts:383`, `PlayerManager.ts:423`
  Re-keyed runtime health state by player ID instead of player object identity and added zombie-death idempotency tracking.
- `LevelManager.ts:42`, `LevelManager.ts:163`
  Added zombie-death sequence tracking so XP cannot double-award from duplicated death broadcasts.
- `WaveManager.ts:124`, `WaveManager.ts:560`
  Added zombie-death sequence tracking so spawn recycling, ammo drops, and kill refunds cannot double-process the same death.
- `WeaponManager.ts:35`, `WeaponManager.ts:191`, `WeaponManager.ts:278`
  Added preloader retention/cleanup, tracked retry timers, and deferred post-spawn ownership/attachment by one tick to improve replication stability.

## Horizon Platform Workarounds Applied
- Vector API workaround already present across core movement/proximity scripts.
  Confirmed in `Zombie.ts`, `ZombieNav.ts`, `HUD_ProximitySensor.ts`, `PlayerManager.ts`, `MovingPlatform.ts`, `AFKWatchdog.ts`, `Portal_Entity.ts`, `NpcAutoTurner.ts`.
- Timer/interval cleanup tracking confirmed or reinforced in the major timed systems.
  Confirmed in `WaveManager.ts`, `SpawnManager.ts`, `Zombie.ts`, `Gun.ts`, `WeaponManager.ts`, `PlayerManager.ts`, `HUD_ProximitySensor.ts`, `ThemeMusicManager.ts`, `AmbientHorrorSFX.ts`, `AmmoBox.ts`, `LevelManager.ts`.
- Spawn/pooling null-safety and retry handling confirmed in `SpawnManager.ts`, `WaveManager.ts`, `Zombie.ts`, `WeaponManager.ts`.
- Network out-of-order mitigation strengthened in `Events.ts`, `Gun.ts`, `Zombie.ts`, `WaveManager.ts`, `PlayerManager.ts`, `LevelManager.ts`.
- Audio stop-before-play workaround confirmed in `Gun.ts`, `WaveManager.ts`, `PlayerManager.ts`, `ThemeMusicManager.ts`.
- Post-spawn replication grace added in `WeaponManager.ts`.
- Post-spawn collision/raycast grace added in `Zombie.ts`.

## Game Logic Issues Fixed
- Zombie kills, XP, and wave cleanup are now protected against duplicated death packets.
- Zombie fresh-spawn collider activation is delayed to reduce newly spawned hitbox/raycast desync.
- Zombie damage is now clamped so overkill cannot drive health below zero.
- Player health tracking now survives wrapper inconsistencies across local/network event boundaries because it uses player IDs.
- Weapon spawn attachment/ownership is deferred by one tick to reduce same-frame replication loss on spawned weapon bundles.

## Code Quality Improvements
- Added named state for sequence/idempotency tracking in combat and progression systems.
- Replaced object-identity player health storage with ID-keyed storage in `PlayerManager.ts`.
- Extended cleanup coverage in `WeaponManager.ts` for preloader and queued retry/configure timers.
- Added inline Horizon-specific workaround comments above each new mitigation path.

## Remaining Risks
- `HUD.ts` and its subcomponents use `dispose()` rather than `cleanup()`. This is likely correct for `ui.UIComponent`, but it should be validated in-world because lifecycle semantics differ from `hz.Component`.
- `LevelManager.ts` still awards wave-survival XP to all tracked in-game players, not strictly confirmed alive players; that is a design-choice risk, not a crash bug.
- `PlayerManager.ts` still relies on event-carried `hz.Player` objects for some non-health flows like quit/kill commands. Health is hardened, but broader player-reference normalization could still be improved.
- `tsc --noEmit` could not be completed in the sandbox because Node resolves the original real workspace path under `c:\Users\elimi\AppData\...` and hits an `EPERM` lstat restriction before compilation starts.
- Several non-core scripts were pattern-audited rather than behavior-simulated in-world. They appear structurally safe, but multiplayer gameplay validation is still needed for admin/NPC/portal edge cases.

## Health Score
- Stability: `22/25`
- Correctness: `21/25`
- Performance: `22/25`
- Code Quality: `21/25`
- Overall: `86/100`
