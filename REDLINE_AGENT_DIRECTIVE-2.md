You’re right. I should have searched first. Here is the corrected **Horizon Worlds bug/workaround enforcement block** to paste into your agent prompt.

Sources checked: Meta’s Feedback Center / official bug tracker, Meta community forums, and Horizon scripting docs/blogs. Meta says creators should search the Feedback Center first because it tracks validated investigations and active issues. ([Meta for Developers][1]) Your original uploaded directive is here: 

````markdown
# REDLINE: ZOMBIE ASSAULT — HORIZON WORLDS KNOWN BUGS + WORKAROUND ENFORCEMENT

You are auditing Redline: Zombie Assault for Meta Horizon Worlds. You must not perform generic cleanup only. You must specifically search the codebase for Horizon Worlds engine/API failure patterns and apply known workarounds.

## 1. ASSET SPAWNING FAILURE / ASYNC SPAWN BUG

Known issue:
Meta has an active/backlogged Feedback Center issue where `spawn()` can fail after inviting users from another world because of async asset handling.

Agent must:
- Treat every asset spawn as unreliable.
- Never assume spawn succeeds.
- Null-check every spawned entity.
- Add retry/backoff where safe.
- Add spawn queueing instead of burst spawning.
- Defer setup of spawned enemies by at least 1 frame/tick.
- Validate spawned zombie has all required script/entity refs before activating AI.
- Log failed spawns with component prefix, wave number, asset ID/name, and retry count.
- Never start zombie AI immediately inside the same call path as spawn.

Required pattern:
```ts
const spawned = await this.world.spawnAsset(...);
if (!spawned || spawned.length === 0) {
  this.logWarn("Spawn failed; queued retry");
  this.queueSpawnRetry(spawnRequest);
  return;
}

this.async.setTimeout(() => {
  this.initializeSpawnedZombie(spawned[0]);
}, 100);
````

Reference: Meta has a Horizon Worlds scripting investigation for spawn failure tied to async asset handling. ([Meta for Developers][2])

---

## 2. TYPESCRIPT COMPONENT MISSING / SCRIPT NOT LOADING BUGS

Known issue:
Meta has tracked cases where Horizon Worlds Desktop Editor reports missing TypeScript components, scripts fail to appear in menus, or existing/new TypeScripts stop functioning after updates.

Agent must:

* Audit every script class registration.
* Verify every script extends the correct Horizon base class.
* Verify static `propsDefinition` exists where needed.
* Avoid dynamic class names or patterns that may break component recognition.
* Preserve script filenames and class names unless absolutely necessary.
* If a script is attached in the world, never rename it without also documenting required editor reattachment.
* Add a final report section: “Scripts that may require manual reattach/recompile in Desktop Editor.”
* If cloning/importing breaks a script, instruct user to recreate/reattach the TS component in the editor, not just change code.

Known failure signatures:

```text
Cannot instantiate missing TS component
Missing TypeScript component
Script unavailable in scripting menu
Existing TypeScripts fail to function
```

References: Meta tracked missing TS component errors and broader TypeScript functionality breakage in Desktop Editor. ([Meta for Developers][3])

---

## 3. LOCAL getComponents() OWNERSHIP / LOADING BUG

Known issue:
Community reports show `entity.getComponents()` may fail locally unless that player previously owned/grabbed the entity. Server/NPC context may see the component while another local client does not.

Agent must:

* Do not rely on local `getComponents()` for critical hit detection, weapon identity, zombie identity, or damage authority.
* Do not use local component discovery as the source of truth for combat.
* Use explicit registered IDs, tags, props, or server-authoritative maps.
* For weapon hits, send an event with validated weapon ID/player ID instead of expecting the hit target to discover the weapon script locally.
* Maintain central registries:

  * `ZombieRegistry`
  * `WeaponRegistry`
  * `PlayerStateRegistry`
* On entity spawn/start, register known components with a stable ID.
* On cleanup/despawn, unregister them.
* If `getComponents()` returns empty, fallback to registry lookup before failing.

Required rule:

```text
Combat must never depend only on local entity.getComponents().
```

Reference: Creator forum report says local `entity.getComponents()` only found components on objects the player had previously owned/grabbed. ([Meta Community Forums][4])

---

## 4. FORCE HOLD / PLAYER SPAWN TIMING BUG

Known issue:
Meta is investigating Force Hold intermittently failing when a player spawns, especially in published sessions and when the player spawns alone.

Agent must:

* Do not attach guns/items to players immediately on player-enter.
* Delay Force Hold / attach / equip logic.
* Retry attach/equip several times.
* Validate both hands after attach.
* Add fallback world pickup/equip state if Force Hold fails.
* Re-run equip validation when:

  * player enters world
  * player respawns
  * player moves after spawn
  * player changes ownership/session state

Required pattern:

```ts
onPlayerEnter(player) {
  this.async.setTimeout(() => this.tryEquipPlayer(player, 1), 250);
}

tryEquipPlayer(player, attempt) {
  const ok = this.forceHoldWeapon(player);
  if (!ok && attempt < 5) {
    this.async.setTimeout(() => this.tryEquipPlayer(player, attempt + 1), 300);
  }
}
```

Reference: Meta has an active investigation where Force Hold may attach one/no objects on player spawn and may not reproduce in edit mode. ([Meta for Developers][5])

---

## 5. EDIT MODE VS PUBLISHED MODE DIFFERENCE

Known issue:
Several Horizon bugs reproduce only in published/live sessions, not edit mode.

Agent must:

* Add debug mode toggles.
* Add in-world debug console support.
* Add multiplayer test hooks.
* Add NPC Gizmo testing instructions for multiplayer/player-enter events.
* Final validation must include:

  * Desktop Editor preview
  * VR preview
  * Published/private test world
  * Solo player
  * 2+ players
  * late joiner
  * player invite from another world
  * respawn after death
  * weapon pickup after respawn

Reference: Meta forum debugging guide recommends standardized logs, Debug Console gizmo, NPC Gizmo for multiplayer mechanics, and testing beyond basic editor flow. ([Meta Community Forums][6])

---

## 6. SCRIPT / CODEBLOCK DISAPPEARING WORKAROUND

Known issue:
Creators report scripts/codeblocks appearing to disappear. Community solution says the script may still exist in the script library/console even if the gizmo/view disappears.

Agent must:

* Never assume a script is deleted only because the gizmo is missing.
* In final report, tell user to check Build Menu → Console/Scripts Library before recreating.
* Name every script clearly.
* Avoid duplicate unnamed scripts.
* Add script registry output so missing/duplicate scripts can be identified.

Reference: Meta community users reported disappearing script gizmos and solved it by finding scripts in the library/console. ([Meta Community Forums][7])

---

## 7. UI / UIComponent RUNTIME FAILURES

Known issue:
Horizon UIComponent scripts commonly fail from undefined props, wrong `.as()` casts, and primitive type mismatches.

Agent must:

* Guard every UI prop.
* Never call `.as()` without checking the prop exists.
* Use lowercase primitives only:

  * `number`
  * `string`
  * `boolean`
* Never use:

  * `Number`
  * `String`
  * `Boolean`
* Throttle text updates.
* Cache previous HUD values.
* Do not call `.set()` every frame unless value changed.

Bad:

```ts
this.props.scoreText.as(TextGizmo).text.set(score.toString());
```

Required:

```ts
const scoreText = this.props.scoreText;
if (!scoreText) {
  this.logWarn("Missing scoreText prop");
  return;
}
const text = scoreText.as(TextGizmo);
if (this.lastScoreText !== nextText) {
  text.text.set(nextText);
  this.lastScoreText = nextText;
}
```

Reference: Horizon scripting guide reports common undefined property/component errors with `.as()` and warns about `Number` vs `number`. ([Medium][8])

---

## 8. UNKNOWN / NEW HORIZON BUG HANDLING

Agent must create a “Horizon Suspected Engine Bug Log” when behavior cannot be explained by project code.

For every suspected engine bug, document:

* Exact symptom
* Editor or published mode
* Solo or multiplayer
* Device used
* Repro steps
* Related script
* Workaround attempted
* Whether it matches existing Meta Feedback Center issues
* Whether user should file/vote/subscribe in Feedback Center

Reference: Meta says creators should check Feedback Center first, vote/subscribe to matching investigations, then use forums/support for new issues. ([Meta for Developers][1])

---

# FINAL AGENT ORDER

You are not allowed to say “fixed” unless you:

1. Found the Horizon-specific failure pattern.
2. Applied the workaround.
3. Added guards/logging.
4. Verified multiplayer behavior.
5. Verified respawn behavior.
6. Verified published-world behavior or documented that it still requires live validation.

Any system touching zombies, weapons, scoring, spawning, player equip, HUD, or multiplayer events must be audited against this workaround list.

```

That is the missing piece: the agent now has **real Horizon bug targets**, not just generic “make it better” instructions.
::contentReference[oaicite:10]{index=10}
```

[1]: https://developers.meta.com/horizon/blog/how-to-get-help-file-bugs-track-fixes-building-with-meta-horizon/ "Blog | Meta Horizon OS Developers"
[2]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/2075746702830513/ "Spawn Function Fails After Inviting Players From Another World | Meta Horizon OS Developers"
[3]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/843087714881558/ "Scripts Failing to Load with Missing TypeScript Component Error | Meta Horizon OS Developers"
[4]: https://communityforums.atmeta.com/discussions/Creator_Discussion/entity-getcomponents-not-working/1310537 "entity.getComponents() not working | Meta Community Forums - 1310537"
[5]: https://developers.meta.com/horizon/feedback/horizon-worlds/investigations/3169937169854190/ "Force Hold on Player Spawn Fails Intermittently | Meta Horizon OS Developers"
[6]: https://communityforums.atmeta.com/discussions/General_Development_Discussion/debugging-features/1295094 "Debugging Features | Meta Community Forums - 1295094"
[7]: https://communityforums.atmeta.com/discussions/Creator_Discussion/codeblocks-script-disappearing-%E2%80%93-bug-or-issue/1302361?utm_source=chatgpt.com "Codeblocks Script Disappearing – Bug or Issue?"
[8]: https://medium.com/%40reclowill/scripting-in-meta-horizon-worlds-c63b80603889?utm_source=chatgpt.com "Scripting in Meta Horizon Worlds"
