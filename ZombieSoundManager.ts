import * as hz from 'horizon/core';
import { Events } from 'Events';

/**
 * ZOMBIE SOUND MANAGER
 * Centralized manager for all zombie-related audio.
 * Handles attack sounds, death sounds, and ambient moans.
 * 
 * USAGE:
 * 1. Create an empty entity and attach this script
 * 2. Assign audio gizmos to the prop slots
 * 3. PlayerManager will use this via exported functions
 */

// ============================================================================
// EXPORTED SOUND ARRAYS (for PlayerManager to access)
// ============================================================================
export let zombieAttackSFXs: hz.Entity[] = [];
export let zombieDeathSFXs: hz.Entity[] = [];
export let zombieMoanSFXs: hz.Entity[] = [];
export let zombieHitSFXs: hz.Entity[] = [];

// ============================================================================
// ZOMBIE SOUND MANAGER COMPONENT
// ============================================================================
class ZombieSoundManager extends hz.Component<typeof ZombieSoundManager> {
  static propsDefinition = {
    // Random hit sounds (when zombie hits player)
    HitSFX1: { type: hz.PropTypes.Entity },
    HitSFX2: { type: hz.PropTypes.Entity },
    HitSFX3: { type: hz.PropTypes.Entity },
    HitSFX4: { type: hz.PropTypes.Entity },
    HitSFX5: { type: hz.PropTypes.Entity },
    
    // Zombie attack sounds (growls when attacking)
    zombieSFX1: { type: hz.PropTypes.Entity },
    zombieSFX2: { type: hz.PropTypes.Entity },
    zombieSFX3: { type: hz.PropTypes.Entity },
    zombieSFX4: { type: hz.PropTypes.Entity },
    zombieSFX5: { type: hz.PropTypes.Entity },
    zombieSFX6: { type: hz.PropTypes.Entity },
    zombieSFX7: { type: hz.PropTypes.Entity },
    zombieSFX8: { type: hz.PropTypes.Entity },
    zombieSFX9: { type: hz.PropTypes.Entity },
    zombieSFX10: { type: hz.PropTypes.Entity },
    
    // Zombie death sounds
    deathSFX1: { type: hz.PropTypes.Entity },
    deathSFX2: { type: hz.PropTypes.Entity },
    deathSFX3: { type: hz.PropTypes.Entity },
    deathSFX4: { type: hz.PropTypes.Entity },
    deathSFX5: { type: hz.PropTypes.Entity },
    deathSFX6: { type: hz.PropTypes.Entity },
    deathSFX7: { type: hz.PropTypes.Entity },
    deathSFX8: { type: hz.PropTypes.Entity },
    deathSFX9: { type: hz.PropTypes.Entity },
    deathSFX10: { type: hz.PropTypes.Entity },
    
    // Ambient zombie moans (random sounds while alive)
    moanSFX1: { type: hz.PropTypes.Entity },
    moanSFX2: { type: hz.PropTypes.Entity },
    moanSFX3: { type: hz.PropTypes.Entity },
    moanSFX4: { type: hz.PropTypes.Entity },
    moanSFX5: { type: hz.PropTypes.Entity },
    moanSFX6: { type: hz.PropTypes.Entity },
    moanSFX7: { type: hz.PropTypes.Entity },
    moanSFX8: { type: hz.PropTypes.Entity },
    moanSFX9: { type: hz.PropTypes.Entity },
    moanSFX10: { type: hz.PropTypes.Entity },

    // ========================================================================
    // VOLUMES (0.0 - 1.0)
    // ========================================================================
    hitVolume: { type: hz.PropTypes.Number, default: 0.8 },
    attackVolume: { type: hz.PropTypes.Number, default: 1.0 },
    deathVolume: { type: hz.PropTypes.Number, default: 1.0 },
    moanVolume: { type: hz.PropTypes.Number, default: 0.6 },
  };

  // Static storage so exported functions can access prop values
  static volHit = 0.8;
  static volAttack = 1.0;
  static volDeath = 1.0;
  static volMoan = 0.6;

  preStart(): void {
    // Sync props to static storage
    ZombieSoundManager.volHit = this.props.hitVolume ?? 0.8;
    ZombieSoundManager.volAttack = this.props.attackVolume ?? 1.0;
    ZombieSoundManager.volDeath = this.props.deathVolume ?? 1.0;
    ZombieSoundManager.volMoan = this.props.moanVolume ?? 0.6;

    // Build attack sound list
    const attackList = [
      this.props.zombieSFX1, this.props.zombieSFX2, this.props.zombieSFX3,
      this.props.zombieSFX4, this.props.zombieSFX5, this.props.zombieSFX6,
      this.props.zombieSFX7, this.props.zombieSFX8, this.props.zombieSFX9,
      this.props.zombieSFX10
    ];
    zombieAttackSFXs = attackList.filter((s): s is hz.Entity => !!s);
    
    // Build death sound list
    const deathList = [
      this.props.deathSFX1, this.props.deathSFX2, this.props.deathSFX3,
      this.props.deathSFX4, this.props.deathSFX5, this.props.deathSFX6,
      this.props.deathSFX7, this.props.deathSFX8, this.props.deathSFX9,
      this.props.deathSFX10
    ];
    zombieDeathSFXs = deathList.filter((s): s is hz.Entity => !!s);
    
    // Build moan sound list
    const moanList = [
      this.props.moanSFX1, this.props.moanSFX2, this.props.moanSFX3,
      this.props.moanSFX4, this.props.moanSFX5, this.props.moanSFX6,
      this.props.moanSFX7, this.props.moanSFX8, this.props.moanSFX9,
      this.props.moanSFX10
    ];
    zombieMoanSFXs = moanList.filter((s): s is hz.Entity => !!s);
    
    // Build hit sound list
    const hitList = [
      this.props.HitSFX1, this.props.HitSFX2, this.props.HitSFX3,
      this.props.HitSFX4, this.props.HitSFX5
    ];
    zombieHitSFXs = hitList.filter((s): s is hz.Entity => !!s);
  }

  start(): void {}
}

// ============================================================================
// HELPER FUNCTIONS (for other scripts to play sounds)
// ============================================================================

// HELPER: Check distance to local player (Simple optimization)
function shouldPlaySound(pos: hz.Vec3): boolean {
  try {
      return true; 
  } catch { return true; }
}

/**
 * Plays a random zombie attack sound at the specified position.
 */
export function playZombieAttack(pos: hz.Vec3): void {
  if (zombieAttackSFXs.length === 0) return;
  const sfx = zombieAttackSFXs[Math.floor(Math.random() * zombieAttackSFXs.length)];
  const audio = sfx.as(hz.AudioGizmo);
  if (!audio) return; 
  try {
    sfx.position.set(pos);
    audio.volume.set(ZombieSoundManager.volAttack); // Apply Volume
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    audio.stop();
    audio.play();
  } catch (e) { }
}

/**
 * Plays a random zombie death sound at the specified position.
 */
export function playZombieDeath(pos: hz.Vec3): void {
  if (zombieDeathSFXs.length === 0) return;
  const sfx = zombieDeathSFXs[Math.floor(Math.random() * zombieDeathSFXs.length)];
  const audio = sfx.as(hz.AudioGizmo);
  if (!audio) return; 
  try {
    sfx.position.set(pos);
    audio.volume.set(ZombieSoundManager.volDeath); // Apply Volume
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    audio.stop();
    audio.play();
  } catch (e) { }
}

/**
 * Plays a random zombie moan sound at the specified position.
 */
export function playZombieMoan(pos: hz.Vec3): void {
  if (zombieMoanSFXs.length === 0) return;
  const sfx = zombieMoanSFXs[Math.floor(Math.random() * zombieMoanSFXs.length)];
  const audio = sfx.as(hz.AudioGizmo);
  if (!audio) return; 
  try {
    sfx.position.set(pos);
    audio.volume.set(ZombieSoundManager.volMoan); // Apply Volume
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    audio.stop();
    audio.play();
  } catch (e) { }
}

/**
 * Plays a random zombie hit sound at the specified position.
 */
export function playZombieHit(pos: hz.Vec3): void {
  if (zombieHitSFXs.length === 0) return;
  const sfx = zombieHitSFXs[Math.floor(Math.random() * zombieHitSFXs.length)];
  const audio = sfx.as(hz.AudioGizmo);
  if (!audio) return; 
  try {
    sfx.position.set(pos);
    audio.volume.set(ZombieSoundManager.volHit); // Apply Volume
    // HORIZON BUG WORKAROUND: Audio double-play — always stop before play on AudioGizmo.
    audio.stop();
    audio.play();
  } catch (e) { }
}

hz.Component.register(ZombieSoundManager);
