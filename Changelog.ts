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
            "=== UPDATE v25.1.0 (Apr 18) ===\n" +
            "PERFORMANCE & BUG FIX PASS\n\n" +
            "• Ammo drops now instant\n" +
            "  - No more invisible boxes on spawn\n" +
            "• Zombie kill count now accurate\n" +
            "  - HUD updates immediately on kill\n" +
            "• Smoother waves\n" +
            "  - Fixed phantom zombies after resets\n" +
            "  - Win condition more reliable\n" +
            "• Major lag reduction\n" +
            "  - Removed hundreds of per-frame\n" +
            "    update loops across all scripts\n" +
            "• Crash fixes\n" +
            "  - Stale timers cancelled on cleanup\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
