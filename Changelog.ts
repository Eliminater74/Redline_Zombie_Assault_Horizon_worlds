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
            "=== UPDATE v26.1.4 (May 7) ===\n" +
            "STABILITY & BUG FIXES\n\n" +
            "• Zombie bodies now vanish on kill\n" +
            "  - Fixed bodies staying on ground\n" +
            "    and blocking wave completion\n" +
            "• Fixed ghost zombie counts\n" +
            "  - Waves now always end cleanly\n" +
            "  - No more phantom zombies in\n" +
            "    the active count\n" +
            "• Freeze recovery: if a player\n" +
            "  gets stuck/frozen the server\n" +
            "  auto-teleports them back in\n" +
            "• New zombie: Samurai joining\n" +
            "  the horde soon\n\n" +
            "HOLD THE LINE. BREAK YOUR RECORD."
        );
    }
  }
}

hz.Component.register(Changelog);
