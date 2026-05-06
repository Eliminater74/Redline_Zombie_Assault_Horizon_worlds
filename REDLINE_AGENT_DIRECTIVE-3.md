Key researched issues to add:

* `spawn()` can fail from async asset handling after cross-world invites. ([Meta for Developers][1])
* Force Hold can fail on player spawn, especially in published sessions. ([Meta for Developers][2])
* Missing/broken TypeScript components can happen after Desktop Editor updates. ([Meta for Developers][3])
* `entity.getComponents()` can fail locally depending on ownership/history. ([Meta Community Forums][4])
* Async callbacks can fire before spawned/player refs are assigned. ([Meta Community Forums][5])
* Published worlds can behave differently than editor preview. ([Meta Community Forums][6])

Paste this into your original under **Phase 2**, or I can merge it into the whole directive:

````markdown
## 2.X — RESEARCHED HORIZON WORLDS BUGS & REQUIRED WORKAROUNDS

The agent must treat Horizon Worlds as an unstable multiplayer runtime where editor behavior, published behavior, ownership, script recognition, async timing, and entity replication can differ.

For every issue below, the agent must perform:

DETECT → FIX / WORKAROUND → COMMENT → VALIDATE → REPORT

The agent is not allowed to mark the project fixed unless these known Horizon failure classes are checked.

---

### A. Async Asset Spawn Failure / spawnAsset Failure

Known Horizon issue:
Asset spawning can fail because of asynchronous asset handling, especially after inviting users from another world.

Agent must:
- Null-check every spawn result.
- Wrap every spawn in try/catch.
- Never activate zombie AI immediately after spawn.
- Defer zombie setup by at least one frame/tick.
- Queue spawns instead of burst-spawning.
- Add retry/backoff.
- Log failed spawns with wave number, spawn point, asset name/ID, and retry count.
- Never allow failed spawns to corrupt active zombie counts.

Required fix pattern:

```ts
// HORIZON BUG WORKAROUND:
// Asset spawning can fail because of async asset handling.
// Never assume spawn succeeds.
const spawned = await this.world.spawnAsset(asset, position, rotation);

if (!spawned || spawned.length === 0) {
  this.logWarn("[ZombieSpawner] Spawn failed; queuing retry.");
  this.queueSpawnRetry(request);
  return;
}

this.async.setTimeout(() => {
  this.initializeZombieAfterSpawn(spawned[0]);
}, 100);
````

Validation:

* Test solo.
* Test 2+ players.
* Test late join.
* Test invite from another Horizon world.
* Test high wave spawn pressure.

---

### B. Force Hold / Weapon Equip Failure On Player Spawn

Known Horizon issue:
Force Hold may fail when a player spawns, especially in published sessions or when a player spawns alone.

Agent must:

* Never equip weapons immediately on player-enter.
* Delay initial weapon attach.
* Retry Force Hold several times.
* Validate both hands after equip.
* Re-run equip validation after respawn.
* Add fallback pickup behavior if Force Hold fails.

Required fix pattern:

```ts
// HORIZON BUG WORKAROUND:
// Force Hold can fail during player spawn timing.
// Delay and retry weapon attachment.
private tryEquipPlayer(player: hz.Player, attempt = 1): void {
  const success = this.forceHoldWeapon(player);

  if (!success && attempt < 5) {
    this.async.setTimeout(() => {
      this.tryEquipPlayer(player, attempt + 1);
    }, 300);
    return;
  }

  if (!success) {
    this.logWarn("[WeaponEquip] Force Hold failed after retries; enabling fallback pickup.");
    this.enableFallbackPickup(player);
  }
}
```

Validation:

* Test fresh player join.
* Test solo published world.
* Test respawn.
* Test player moving immediately after spawn.
* Test VR mode, not just editor preview.

---

### C. Missing TypeScript Component / Script Recognition Failure

Known Horizon issue:
Desktop Editor may fail to instantiate TypeScript components or show “Cannot instantiate missing TS component.”

Agent must:

* Verify every script class extends the proper Horizon base class.
* Preserve filenames/class names unless unavoidable.
* Verify static propsDefinition is valid.
* Avoid logic inside propsDefinition.
* Avoid unsupported prop types.
* Add a final list of scripts that may require manual reattach in the editor.
* Never rename attached scripts casually.

Required rule:

```ts
class MyScript extends hz.Component<typeof MyScript> {
  static propsDefinition = {
    target: { type: hz.PropTypes.Entity },
    damage: { type: hz.PropTypes.Number },
  };

  start() {}
}
hz.Component.register(MyScript);
```

Validation:

* Compile project.
* Confirm script appears in Horizon editor.
* Confirm attached components still resolve.
* Confirm no “missing TS component” errors.

---

### D. entity.getComponents() Ownership / Local Lookup Failure

Known Horizon issue:
`entity.getComponents()` may return empty locally even when the entity clearly has the component, especially when ownership history differs between players.

Agent must:

* Never make combat depend only on local `getComponents()`.
* Never make weapon damage depend only on locally discovered component scripts.
* Create central registries for:

  * Zombies
  * Weapons
  * Players
  * Damageable entities
* Register entities on spawn/start.
* Unregister entities on cleanup/death/despawn.
* Use stable IDs instead of local component discovery where possible.

Required rule:

```ts
// HORIZON BUG WORKAROUND:
// entity.getComponents() can fail locally depending on ownership.
// Combat must use registry lookup as source of truth.
const zombie = this.zombieRegistry.get(entityId);

if (!zombie) {
  this.logWarn("[Combat] Hit entity not found in registry; ignoring unsafe local component lookup.");
  return;
}
```

Validation:

* Test Player 1 shooting zombie.
* Test Player 2 shooting same zombie.
* Test weapon picked up/dropped by different players.
* Test projectile/raycast hit from non-owner.
* Test late joiner hitting existing zombie.

---

### E. Async Callback Before Player / Spawned Entity Assignment

Known Horizon issue:
Async intervals may start before player or spawned asset references are assigned, causing undefined errors.

Agent must:

* Never assume `this.player`, `this.owner`, or spawned entity refs exist inside intervals.
* Guard every async callback.
* Track initialization state.
* Cancel timers in cleanup.
* Delay intervals until required refs exist.

Required pattern:

```ts
// HORIZON BUG WORKAROUND:
// Async callbacks may fire before spawned/player refs are assigned.
this.interval = this.async.setInterval(() => {
  if (!this.initialized || !this.trackedPlayer || !this.entity) {
    return;
  }

  this.safeTick();
}, 250);
```

Validation:

* Test spawned zombie scripts.
* Test player joins during active wave.
* Test respawn during interval.
* Test wave reset while intervals are active.

---

### F. Published World Differs From Editor Preview

Known Horizon issue:
Published worlds can behave differently from Desktop Editor preview.

Agent must not validate only in editor.

Agent must add final validation matrix:

```text
[ ] Desktop Editor preview
[ ] VR preview
[ ] Published private test world
[ ] Solo player
[ ] 2+ players
[ ] Late joiner
[ ] Player invited from another world
[ ] Player respawn
[ ] Weapon pickup/drop
[ ] High zombie count wave
[ ] Wave reset / game restart
```

Any issue that only appears in published mode must be logged separately as:

```text
PUBLISHED-ONLY HORIZON ISSUE
Symptom:
Repro steps:
Affected system:
Workaround attempted:
Remaining manual test required:
```

---

### G. UI / TextGizmo / HUD Update Hitching

Agent must:

* Throttle all HUD updates.
* Never call `.text.set()` every frame.
* Cache previous value.
* Update only when changed.
* Batch score/wave/ammo updates.

Required pattern:

```ts
if (this.lastAmmoText !== nextAmmoText) {
  this.ammoText.text.set(nextAmmoText);
  this.lastAmmoText = nextAmmoText;
}
```

HUD max update rate:

```text
10 updates per second max unless critical.
```

---

### H. Unknown Horizon Engine Bug Protocol

If behavior cannot be explained by project code, the agent must create a suspected engine bug report.

Required format:

```text
HORIZON SUSPECTED ENGINE BUG

Symptom:
Editor or published:
Solo or multiplayer:
Device:
Script/component:
Exact repro steps:
Expected behavior:
Actual behavior:
Workaround attempted:
Related known issue:
Needs Meta Feedback Center report? YES/NO
```

---

## Phase 2 Exit Requirement

The agent must not continue to final report until it has audited:

* spawn logic
* Force Hold / weapon equip
* TypeScript component registration
* getComponents usage
* async timers
* player join/respawn
* published-mode risks
* HUD update rate
* multiplayer ownership

```


::contentReference[oaicite:7]{index=7}
```

[1]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/2075746702830513/?utm_source=chatgpt.com "Spawn Function Fails After Inviting Players From Another World"
[2]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/3169937169854190/?utm_source=chatgpt.com "Force Hold on Player Spawn Fails Intermittently"
[3]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/1181643596713201/?utm_source=chatgpt.com "Error instantiating TypeScript components post November 21st"
[4]: https://communityforums.atmeta.com/discussions/Creator_Discussion/entity-getcomponents-not-working/1310537?utm_source=chatgpt.com "entity.getComponents() not working | Meta Community Forums"
[5]: https://communityforums.atmeta.com/discussions/Creator_Discussion/async-setinterval-issue-spawned-asset/1318195?utm_source=chatgpt.com "Async SetInterval Issue (spawned asset)"
[6]: https://communityforums.atmeta.com/discussions/Creator_Discussion/published-world-different-from-editor/1312299/replies/1312688?utm_source=chatgpt.com "Published world different from Editor | Meta Community Forums"
