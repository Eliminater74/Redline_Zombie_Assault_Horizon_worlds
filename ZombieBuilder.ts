import * as hz from 'horizon/core';
import { AccessControl } from 'AccessControl';

/**
 * ZOMBIE BUILDER GUIDE
 * Attaches to a Text Gizmo.
 * Only visible to Admins/Creators/Testers.
 * Displays instructions on how to set up zombies.
 */
class ZombieBuilder extends hz.Component<typeof ZombieBuilder> {
  static propsDefinition = {
    // No external props needed, attaches to self
  };

  // --- ACCESS CONTROL ---
  // Now uses shared AccessControl module

  // --- THE GUIDE TEXT ---
  private readonly guideText = 
    "--- ZOMBIE MAKER RECIPE ---\n\n" +
    "1. PREP BODY\n" +
    "   - Drag Asset Bundle into world.\n" +
    "   - Name it (e.g. 'FastZombie').\n\n" +
    "2. ADD BRAINS\n" +
    "   - Attach 'Zombie' Script.\n" +
    "   - Drag Zombie itself into 'collider' slot.\n\n" +
    "3. ADD LEGS (Locomotion)\n" +
    "   - Property Panel -> 'Navigation Locomotion'\n" +
    "   - Set 'Enabled' -> ON (Blue)\n\n" +
    "4. TUNE IT\n" +
    "   - Speed: 4.0 - 7.0\n" +
    "   - Angular Speed: 120\n" +
    "   - Acceleration: 10\n\n" +
    "5. SAVE IT\n" +
    "   - Create new Asset from it.\n" +
    "   - Drag into WaveManager slots.";

  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    if (!textGizmo) {
        console.warn("ZombieBuilder script must be attached to a Text Gizmo!");
        return;
    }

    // Check if Local Player is Admin
    const player = this.world.getLocalPlayer(); 
    if (player && this.hasAccess(player)) {
        // ADMIN: Show the guide
        textGizmo.text.set(this.guideText);
        this.entity.visible.set(true);
    } else {
        // VISITOR: Hide everything
        textGizmo.text.set("");
        this.entity.visible.set(false);
    }
  }

  private hasAccess(player: hz.Player): boolean {
      return AccessControl.hasAccess(player, this.entity);
  }
}

hz.Component.register(ZombieBuilder);
