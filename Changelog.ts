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
            "=== UPDATE v26.1.2 (Apr 26) ===\n" +
            "NAVIGATION & SPAWN ZONES\n\n" +
            "• Exclusion zones added\n" +
            "  - Outside walls: zombies no\n" +
            "    longer spawn between walls\n" +
            "  - Safe zones: zombies no\n" +
            "    longer spawn on top of them\n" +
            "• Navigation system updated\n" +
            "  - Improved zone coverage\n" +
            "  - Cleaner boundary handling\n" +
            "• Bug fixes & cleanup\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
