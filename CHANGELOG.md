# Redline: Zombie Assault — Changelog

---

## [26.0.0] — 2026-04-19

### Zombie AI

- **Zombie.ts** — Wave-scaled aggression: attack cooldown scales from 2500ms → 1700ms, attack range from 2.5m → 3.0m, brain tick rate from 200ms → 120ms across waves 1–30+.
- **Zombie.ts** — Last-known-position pursuit: zombies chase the last seen position for 8 seconds after losing a target instead of immediately stopping.
- **Zombie.ts** — Cooperative targeting: module-level `targetPressure` map tracks how many zombies are on each player. In multiplayer, zombies spread across all players instead of piling on one.

### Spawn System

- **SpawnManager.ts** — Root cause of `0/N` spawn hang identified and fixed: `dispose()` on a Loading controller cancelled the in-progress bundle download, preventing the cache from populating. Each retry started a fresh download that also got cancelled — infinite loop.
- **SpawnManager.ts** — `startWave()` now keeps controllers in `Loaded`/`Loading` state instead of disposing all. Fresh controllers only created for remaining slots, with `load()` called immediately.
- **SpawnManager.ts** — `spawnNextBatch()` skips `load()` if controller is already `Loaded` (preloaded), going straight to `spawn()` for near-instant zombie appearance.
- **SpawnManager.ts** — All fresh replacement controllers (timeout, error, recycle paths) now immediately call `load()` after creation to pre-warm for next use.
- **SpawnManager.ts** — `preloadPool()` updated to guarantee all zombie variants are loaded (one controller per variant first, then random fill). Prevents cache misses on less common variants.
- **WaveManager.ts** — `preloadPool()` called in `start()` so bundle downloads begin during lobby time, completing before wave 1 starts.

### HUD

- **HUD.ts** — Local clock added to bottom-right corner. 12-hour format with AM/PM. Updates every second. Interval properly cancelled in `dispose()`.
- **HUD_ProximitySensor.ts** — Left/right direction inverted. Horizon's right vector points opposite to UI convention — swapped `sensorLeft`/`sensorRight` bindings to match actual threat direction.
- **HUD.ts** — Version string updated to v26.0.0.

---

## [25.1.0] — 2026-04-18

### Performance
- **AmmoBox.ts** — Replaced `World.onUpdate` (60 FPS per instance) with `setInterval(50ms)`. With 60 boxes active this eliminated ~3,600 redundant calls/sec.
- **FloatingDamage.ts** — Replaced `World.onUpdate` with `setInterval(50ms)`. Float animation now only starts after `initFloatingDamage` event fires, eliminating idle overhead.
- **PirateTrigger.ts** — Replaced `World.onUpdate` with `setInterval(100ms)` started after `npcPlayer` resolves. NPC look-at doesn't need frame accuracy.
- **WaveManager.ts** — Eliminated ammo box spawn delay. Root cause: per-drop code was calling `sc.load().then(() => sc.spawn())` — two sequential async round-trips to Horizon's runtime. Fixed by calling `sc.spawn()` directly (matching the pattern SpawnManager uses for zombies), with the preloader still warming the bundle cache at game start for the first drop.

### Bug Fixes
- **SpawnManager.ts** — `dyingZombies` Set used JS object reference equality (`Set.has()`). Entity wrappers from `rootEntities.get()` and `Events.zombieDeath` are different JS objects for the same entity, so `has()` always returned `false`. Dead zombies were never excluded from `getActiveCount()` — the HUD zombie count didn't drop until 3.5 seconds after each kill. Fixed by adding `dyingZombieIds: Set<bigint>` and comparing by entity ID.
- **SpawnManager.ts** — `handleZombieDeath()` orphan path (zombie with no controller match) incremented `zombiesRemainingToSpawn` even during `forceKillAll()` / wave reset, potentially spawning a phantom zombie in the 1-second window before the next wave. Fixed with `if (!this.isClearing)` guard.
- **WaveManager.ts** — `scheduleCountUpdate()` deferred broadcast timeout had no stored handle. It could not be cancelled in `cleanup()`, and if it fired on a destroyed component it would leave `countBroadcastPending` in a broken state. Fixed with `countBroadcastTimer: number | null`.
- **WaveManager.ts** — `onWaveReset()` and `onWaveSkip()` 1-second delay before `newWave()` had no stored handle. A rapid double-reset/skip within 1 second queued two concurrent `newWave()` calls. Fixed with `waveTransitionTimer: number | null` cancelled before re-scheduling.
- **Zombie.ts** — `performAttack()` had two `setTimeout` calls (300ms speed reset, 625ms damage check) with no stored handles and no `cleanup()` method. If a zombie was unloaded mid-attack, both callbacks fired on the destroyed entity. Added `attackSpeedTimer` / `attackDamageTimer` handles and a `cleanup()` method that cancels both and unregisters from `ZombieUpdateManager`.
- **ZombieUpdateManager.ts** — Module-level `isInitialized` flag was never reset. After a script reload, the new instance found the flag already `true` and skipped connecting the update loop, silently killing all zombie AI. Fixed by adding `cleanup()` that resets `isInitialized = false`.
- **Portal_Entity.ts** — Five `?.as(Type).method()` call sites crashed when `as()` returned `null` (the `?.` only guards the prop being undefined, not the cast result). Fixed all five to `?.as(Type)?.method()`:
  - `teleportSFX?.as(AudioGizmo)?.position.set(...)`
  - `teleportVFX?.as(ParticleGizmo)?.position.set(...)`
  - `teleportVFX?.as(ParticleGizmo)?.play()`
  - `nonRandomDefaultSpawnPoint?.as(SpawnPointGizmo)?.teleportPlayer(player)`
  - `?.as(AudioGizmo)?.stop()` / `?.as(ParticleGizmo)?.stop()`
- **PirateTrigger.ts** — `removeTarget()` called rapidly (e.g. player enters/exits quickly) stacked multiple 1s + 2s timer pairs that all fired concurrently and fought each other over the look-at target. Fixed by cancelling existing timers before scheduling new ones.
- **Knife.ts** — `hitCooldownTimer` handle was not stored. If the knife was despawned during a cooldown the callback fired on a destroyed entity. Added stored handle and `cleanup()`.
- **VisitorLeaderboard.ts** — Per-player 2-second load delay timer had no per-player handle. If a player left before the timer fired it would try to write persistent storage for an invalid player. Added `pendingTimers: Map<number, number>` with cancellation on `OnPlayerExitWorld` and `cleanup()`.
- **LobbySpawnGuard.ts** — Per-player spawn delay timer had no stored handle. Players who left during the delay window were still teleported (to a now-missing player). Added `pendingSpawns: Map<number, number>` with cancellation on `OnPlayerExitWorld`, `player.isValidReference.get()` check inside callback, and `cleanup()`.

### Maintenance
- Removed `.editor` file from git tracking (`git rm --cached .editor`).

---

## [25.0.0] — baseline

Initial tracked version.
