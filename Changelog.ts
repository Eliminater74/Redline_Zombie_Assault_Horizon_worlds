import * as hz from 'horizon/core';

/**
 * CHANGELOG DISPLAY
 * Attaches to a Text Gizmo and displays the latest updates.
 */
class Changelog extends hz.Component<typeof Changelog> {
  static propsDefinition = {};

  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    if (textGizmo) {
        textGizmo.text.set(
            "=== UPDATE v26.1.3 (May 3) ===\n" +
            "SMARTER ZOMBIES & AMMO BOARD\n\n" +
            "• Zombies got trickier\n" +
            "  - Hit Rush: wounding a zombie\n" +
            "    makes it charge faster (1.9x)\n" +
            "    for 1.5s — finish your kills\n" +
            "  - Ammo awareness: picking up\n" +
            "    ammo alerts nearby zombies\n" +
            "  - Coordinated flanking: groups\n" +
            "    now encircle from all sides\n" +
            "• New leaderboard: Most Ammo\n" +
            "  - Tracks lifetime ammo pickups\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
