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
            "=== UPDATE v26.0.0 (Apr 19) ===\n" +
            "AI, SPAWN & HUD OVERHAUL\n\n" +
            "• Smarter Zombies\n" +
            "  - Speed, aggression & range\n" +
            "    scale with wave number\n" +
            "  - Chase last known position\n" +
            "    for 8s after losing target\n" +
            "  - Spread across players in\n" +
            "    multiplayer (no pile-ons)\n" +
            "• Spawn fix\n" +
            "  - Bundles preload during lobby\n" +
            "  - No more 0/N stuck waves\n" +
            "• Proximity sensor fixed\n" +
            "  - Left/right direction corrected\n" +
            "• Local clock on HUD\n" +
            "  - Bottom-right corner\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
