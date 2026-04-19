# REDLINE: ZOMBIE ASSAULT — Feature & Fix TODO

---

## 🖥️ HUD IMPROVEMENTS

### Available HUD Real Estate (from layout analysis)
| Area | Position | Currently Empty? |
|------|----------|-----------------|
| Bottom-right corner | `bottom: 0, right: 32` | ✅ Yes — best clock spot |
| Top-left below player list | `top: ~200, left: 32` | ✅ Yes |
| Below zombie counter | `top: ~500, right: 32` | ✅ Yes |

### Ideas
- [ ] **Local Clock** — `new Date().toLocaleTimeString()` on a 1s setInterval. Bottom-right corner (`bottom: 0, right: 32`). No server needed, pure client-side.
- [ ] **Session Timer** — "Time in session: 00:34:12". Could go next to clock.
- [ ] **Wave Timer** — Show how long current wave has been running (waveStartTime already tracked in WaveManager).
- [ ] **Kill Streak Indicator** — "🔥 5 KILLS IN A ROW!" flash overlay, similar to headshot indicator.
- [ ] **Low Ammo Voice/Sound** — Trigger audio cue when mag hits 0, not just visual.
- [ ] **XP Gain Popup** — Float "+10 XP" / "+25 XP HEADSHOT" above kill counter when xpGain event fires.

---

## 🧟 ZOMBIE / GAMEPLAY

- [ ] **Wave Difficulty Preview** — Before wave starts, flash "WAVE 5 — FAST ZOMBIES" or similar based on speed/health scaling.
- [ ] **Boss Wave** — Every 5th wave spawns one high-HP named zombie (e.g. "THE BUTCHER") with different model.
- [ ] **Kill Bonus Rounds** — Random wave modifier: "DOUBLE XP ROUND", "HEADSHOTS ONLY FOR BONUS", etc.
- [ ] **Zombie Variants by Wave** — Force lich/skeleton types on higher waves instead of random mix.
- [ ] **On-Death Loot Scaling** — Higher waves = higher ammo drop chance (currently flat 41.6%).

---

## 🔧 SPAWN SYSTEM

- [ ] **Loading Indicator** — While `L > 0` (bundles downloading), show "Preparing Wave..." text instead of "Spawning... 0/N" which looks broken.
- [ ] **Per-Wave Preload** — After wave ends, immediately start loading next wave's controllers during the inter-wave gap (currently not done).
- [ ] **Spawn FX** — Play particle/sound at spawn point when zombie appears, instead of just teleporting in.

---

## 📊 STATS / PERSISTENCE

- [ ] **Lifetime Stats Reset Option** — Admin-only button to wipe a player's persistence (for testing).
- [ ] **Accuracy Tracking** — Track shots fired vs hits landed, show as a stat.
- [ ] **Best Kill Streak** — Track and save longest kill streak per player.
- [ ] **Total Waves Survived** — Cumulative across all sessions (different from Best Wave).

---

## 🔊 AUDIO

- [ ] **Dynamic Music Intensity** — Speed up or layer music track as zombie count drops toward 0.
- [ ] **Wave Clear Fanfare** — Play a victory sting when last zombie dies.
- [ ] **Proximity Audio Cue** — Play low heartbeat/tense music when proximity sensor is active.

---

## 🛠️ ADMIN / DEBUG

- [ ] **Admin HUD Panel** — Small overlay for admins showing wave gen, active/pending/remaining in real-time (currently only on Reset Station display).
- [ ] **Skip to Wave N** — Admin trigger that jumps directly to a specific wave number.
- [ ] **Debug Toggle** — Hotkey or trigger to show/hide the `A:0 L:0 P:0 Q:0` debug line for non-admin players.

---

## ✅ RECENTLY COMPLETED
- [x] Proximity sensor left/right flip fixed
- [x] Spawn hang fixed — preload during lobby, keep Loaded controllers between waves
- [x] Zombie AI — wave-scaled aggression, last-known-position pursuit, cooperative targeting
- [x] Timer leak fixes across all managers
- [x] Entity reference equality bug (bigint IDs for Set/Map)
