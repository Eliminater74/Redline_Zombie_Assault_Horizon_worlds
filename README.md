# Redline: Zombie Assault

![Visitors](https://visitor-badge.laobi.icu/badge?page_id=Eliminater74.Redline_Zombie_Assult_Horizon_worlds&left_color=grey&right_color=red&left_text=Visitors)
![GitHub Stars](https://img.shields.io/github/stars/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=github&color=yellow)
![GitHub Forks](https://img.shields.io/github/forks/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=github&color=blue)
![Last Commit](https://img.shields.io/github/last-commit/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=git&color=brightgreen)
![Repo Size](https://img.shields.io/github/repo-size/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&color=orange)
![TypeScript](https://img.shields.io/badge/TypeScript-4.7.4-3178C6?style=flat&logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Meta%20Horizon%20Worlds-blueviolet?style=flat&logo=meta)

A wave-based zombie survival game built in [Meta Horizon Worlds](https://www.meta.com/horizon-worlds/). Fight through endless waves of increasingly aggressive zombies, rack up kills, and compete on the leaderboard.

**Current Version:** v26.1.3

---

## Gameplay

- Survive escalating waves of zombies that grow faster, more aggressive, and more numerous as waves progress.
- Collect ammo boxes and health pickups scattered across the map.
- Defend safe zones — marked areas that zombies cannot spawn inside.
- Compete for high scores tracked on a persistent leaderboard.
- Solo or multiplayer — zombie targeting spreads across all players so no single player gets overwhelmed.

---

## Features

### Zombie AI
- Wave-scaled difficulty: attack cooldown, attack range, and brain tick rate all improve with wave number.
- Last-known-position pursuit: zombies chase where they last saw you for 8 seconds after losing sight.
- Cooperative targeting: zombies distribute across all players in multiplayer to prevent pile-ons.
- Stuck recovery: persistently stuck zombies are automatically teleported to a valid position.

### Spawn System
- Pool-based spawning with preloaded bundles — zombie variants load during lobby time so wave 1 starts instantly.
- Exclusion zones prevent zombies from spawning in wall gaps or on top of safe zones.
- Full recycle pipeline: dead zombies are tracked by entity ID and recycled cleanly between waves.

### HUD
- Live kill feed, player stats, and wave counter.
- Proximity sensor with correct left/right threat direction.
- Local clock in the bottom-right corner (12-hour AM/PM).
- Floating damage numbers on every hit.

### World Systems
- Persistent leaderboard (top scores survive session resets).
- AFK watchdog that removes idle players.
- Portal system with random and fixed spawn point routing.
- Moving platforms, ambient horror audio, and themed music.
- Admin panel for in-world management.

---

## Project Structure

| File | Purpose |
|---|---|
| `Zombie.ts` | Zombie AI, targeting, attack logic, wave scaling |
| `ZombieNav.ts` | Navigation mesh, exclusion zones, spawn boundaries |
| `ZombieSpawnPoint.ts` | Individual spawn point registration and eligibility |
| `ZombieBuilder.ts` | Zombie variant configuration and assembly |
| `ZombieUpdateManager.ts` | Shared update loop for all active zombies |
| `ZombieSoundManager.ts` | Zombie audio — growls, attacks, death sounds |
| `SpawnManager.ts` | Spawn controller pool, wave batching, preloading |
| `WaveManager.ts` | Wave progression, timing, count broadcasting |
| `GameState.ts` | Central game state machine |
| `GameConfig.ts` | Tunable constants (wave scaling, pool sizes, etc.) |
| `PlayerManager.ts` | Player join/leave, session tracking |
| `HUD.ts` | Main HUD layout and update loop |
| `HUD_ProximitySensor.ts` | Directional threat indicator |
| `HUD_KillFeed.ts` | Scrolling kill feed |
| `HUD_PlayerStats.ts` | Per-player stats panel |
| `HUD_PlayerList.ts` | Live player list |
| `Gun.ts` / `Knife.ts` | Weapon logic and hit detection |
| `WeaponManager.ts` / `WeaponConfig.ts` | Weapon inventory and configuration |
| `AmmoBox.ts` / `HealthPickup.ts` | Pickup spawning and collection |
| `Portal_Entity.ts` / `Portal_Data.ts` | Teleport portal system |
| `LeaderboardManager.ts` / `VisitorLeaderboard.ts` | Score persistence and display |
| `PersistenceManager.ts` / `PersistenceDoctor.ts` | Persistent storage layer and repair |
| `LobbySpawnGuard.ts` | Safe lobby teleport with player validity checks |
| `AFKWatchdog.ts` | Detects and removes AFK players |
| `AccessControl.ts` / `AdminPanel.ts` | World moderation tools |
| `TransientEntityUpdateHub.ts` | Centralized transient entity tick management |
| `Events.ts` | Shared event definitions |
| `Changelog.ts` | In-world changelog text gizmo |

---

## Development

This project is written in TypeScript targeting the Horizon Worlds scripting API (`horizon/core`).

Scripts live in the Meta Horizon Worlds local script editor and are synced via the Horizon Worlds desktop app. The `scripts/` directory is the repo root.

### Prerequisites
- Meta Horizon Worlds desktop app
- Node.js (for TypeScript type checking locally)
- `typescript` 4.7.4 (installed via `npm install`)

### Type Checking

```bash
npx tsc --noEmit
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

---

## Author

Built and maintained by **Eliminater74**.
