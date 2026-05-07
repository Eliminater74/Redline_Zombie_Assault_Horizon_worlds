# Redline: Zombie Assault

[![Visitors](https://visitor-badge.laobi.icu/badge?page_id=Eliminater74.Redline_Zombie_Assult_Horizon_worlds&left_color=grey&right_color=crimson&left_text=Visitors)](https://github.com/Eliminater74/Redline_Zombie_Assult_Horizon_worlds)
[![GitHub Stars](https://img.shields.io/github/stars/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=github&color=yellow)](https://github.com/Eliminater74/Redline_Zombie_Assult_Horizon_worlds/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=github&color=blue)](https://github.com/Eliminater74/Redline_Zombie_Assult_Horizon_worlds/network/members)
[![Last Commit](https://img.shields.io/github/last-commit/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&logo=git&color=brightgreen)](https://github.com/Eliminater74/Redline_Zombie_Assult_Horizon_worlds/commits/main)
[![Repo Size](https://img.shields.io/github/repo-size/Eliminater74/Redline_Zombie_Assult_Horizon_worlds?style=flat&color=orange)](https://github.com/Eliminater74/Redline_Zombie_Assult_Horizon_worlds)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.7.4-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Meta%20Horizon%20Worlds-blueviolet?style=flat&logo=meta)](https://www.meta.com/horizon-worlds/)
[![Version](https://img.shields.io/badge/Version-v26.1.4-red?style=flat)](CHANGELOG.md)

A wave-based zombie survival game built in [Meta Horizon Worlds](https://www.meta.com/horizon-worlds/). Fight through endless waves of increasingly aggressive zombies, earn XP, level up, and compete on five separate leaderboards.

**Current Version:** v26.1.4

---

## What's New — v26.1.4

- **Bodies now vanish on kill** — Fixed dead zombies staying on the ground and blocking wave completion
- **Ghost zombie count fixed** — Waves now always end cleanly with no phantom zombies stuck in the active count
- **Freeze recovery** — If a player gets stuck or frozen mid-game, the server auto-teleports them back in without needing to leave
- **Samurai zombie** — New enemy type joining the horde soon

See [CHANGELOG.md](CHANGELOG.md) for full version history.

---

## Gameplay

- Survive escalating waves of zombies that grow faster, more aggressive, and more numerous as waves progress.
- Collect ammo boxes and health pickups scattered across the map.
- Defend safe zones — marked areas that zombies cannot spawn inside.
- Earn XP for every kill, headshot, wave clear, and survival bonus — level up to show your rank.
- Compete for high scores on five persistent leaderboards: Waves, Kills, Headshots, Level, and Ammo Collected.
- Solo or multiplayer — zombie targeting spreads across all players so no single player gets overwhelmed.

---

## Features

### Zombie AI

- **Wave-scaled difficulty** — attack cooldown, attack range, and brain tick rate all tighten with wave number
- **Last-known-position pursuit** — zombies chase where they last saw you for 8 seconds after losing sight
- **Cooperative targeting** — zombies distribute across all players in multiplayer to prevent pile-ons
- **Coordinated flanking** — each zombie approaches from a spread sector based on its entity ID; groups naturally encircle instead of charging from the same direction
- **Hit Rush** — wounding a zombie without killing it causes it to charge the shooter at 1.9× speed for 1.5 seconds
- **Sound awareness** — zombies investigate gunshot and ammo pickup positions within range
- **Stuck recovery** — persistently stuck zombies are automatically teleported to a valid position
- **Zombie variants** — Female, Male, Skeleton, Lich, Henchman — Samurai coming soon

### Spawn System

- Pool-based spawning with preloaded bundles — all zombie variants load during lobby time so wave 1 starts instantly
- Exclusion zones prevent zombies from spawning in wall gaps or directly on top of safe zones
- Full recycle pipeline: each zombie's SpawnController is polled until the engine confirms the entity is fully gone before the slot is reused — no phantom active counts
- Immediate body hide on kill with a hard 10-second timeout that force-unloads any stuck controller

### HUD

- Live kill feed, player stats panel, and wave counter
- Proximity sensor with correct left/right threat direction
- Local clock in the bottom-right corner (12-hour AM/PM, updates every second)
- Floating damage numbers on every hit with headshot callout
- Ammo and health display with per-player targeting

### Level & XP System

- XP awarded for kills (+10), headshots (+25 bonus), wave clears (+50 × wave), and survival (+5 × wave)
- Level formula: XP needed for level N = 100 × N²
- XP and level persist across sessions per player
- XP gain events broadcast to HUD with source reason and progress

### World Systems

- **Five persistent leaderboards** — Highest Wave, Most Kills, Most Headshots, Experience Level, Most Ammo
- **3-stage AFK watchdog** — soft warning at 20s → freeze recovery teleport at 35s → hard kick at 90s
- **Freeze recovery** — server-side position and rotation staleness detection; recovery fires a native engine teleport that can unstick a frozen Horizon client without a rejoin
- **Portal system** — random and fixed spawn point routing
- Moving platforms, ambient horror audio, and themed music
- **Admin panel** — in-world moderation tools for authorized moderators

---

## Project Structure

| File | Purpose |
| --- | --- |
| `Zombie.ts` | Zombie AI, targeting, attack logic, wave scaling |
| `ZombieNav.ts` | Navigation mesh, exclusion zones, spawn boundaries |
| `ZombieSpawnPoint.ts` | Individual spawn point registration and eligibility |
| `ZombieBuilder.ts` | Zombie variant configuration and assembly |
| `ZombieUpdateManager.ts` | Shared update loop for all active zombies |
| `ZombieSoundManager.ts` | Zombie audio — growls, attacks, death sounds |
| `SpawnManager.ts` | Spawn controller pool, wave batching, preloading, recycle pipeline |
| `WaveManager.ts` | Wave progression, timing, count broadcasting |
| `GameState.ts` | Central game state machine |
| `GameConfig.ts` | Tunable constants (wave scaling, pool sizes, moderator list) |
| `PlayerManager.ts` | Player join/leave, session tracking, freeze recovery handler |
| `AFKWatchdog.ts` | 3-stage AFK detection: soft warn → freeze recovery → hard kick |
| `LevelManager.ts` | XP awards, level calculation, persistence |
| `HUD.ts` | Main HUD layout and update loop |
| `HUD_ProximitySensor.ts` | Directional threat indicator |
| `HUD_KillFeed.ts` | Scrolling kill feed |
| `HUD_PlayerStats.ts` | Per-player stats panel |
| `HUD_PlayerList.ts` | Live player list |
| `HUD_Coriolis.ts` | Secondary HUD component |
| `Gun.ts` / `Knife.ts` | Weapon logic and hit detection |
| `WeaponManager.ts` / `WeaponConfig.ts` | Weapon inventory and configuration |
| `AmmoBox.ts` / `HealthPickup.ts` | Pickup spawning and collection |
| `Portal_Entity.ts` / `Portal_Data.ts` | Teleport portal system |
| `LeaderboardManager.ts` / `VisitorLeaderboard.ts` | Score persistence and display |
| `PersistenceManager.ts` / `PersistenceDoctor.ts` | Persistent storage layer and repair |
| `LobbySpawnGuard.ts` | Safe lobby teleport with player validity checks |
| `AccessControl.ts` / `AdminPanel.ts` | World moderation tools |
| `TransientEntityUpdateHub.ts` | Centralized transient entity tick management |
| `Events.ts` | Shared event definitions (local + network) |
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

### Bumping the Version

A shell script handles all version string updates automatically:

```bash
bash bump-version.sh 26.1.5
```

This updates `README.md`, `HUD.ts`, `Changelog.ts`, and prepends a template entry to `CHANGELOG.md`. Fill in the release notes, then commit.

---

## Author

Built and maintained by **[Eliminater74](https://github.com/Eliminater74)**.
