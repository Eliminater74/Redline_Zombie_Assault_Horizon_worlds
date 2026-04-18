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
            "=== UPDATE v25.0.0 (Apr 8) ===\n" +
            "SMART HORDE + STABILITY PASS\n\n" +
            "• Smarter zombie targeting\n" +
            "  - Aggro memory + better flanking\n" +
            "• Better spawn reliability\n" +
            "  - Stronger refill/replacement logic\n" +
            "• Watchdog tuned down\n" +
            "  - Fewer false stuck resets\n" +
            "• World performance improved\n" +
            "  - Duplicate map blockers removed\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
