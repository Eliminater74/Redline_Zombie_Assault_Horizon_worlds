import * as hz from 'horizon/core';

/**
 * NOTES DISPLAY
 * Attaches to a Text Gizmo to show important info to players.
 */
class Notes extends hz.Component<typeof Notes> {
  static propsDefinition = {};

  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    if (textGizmo) {
        textGizmo.text.set(
            "⚠️ IMPORTANT NOTES ⚠️\n\n" +
            "1. When you join, weapons can take up to 30 seconds to spawn. Please wait!\n\n" +
            "2. If your weapons disappear or float away, DON'T PANIC!\n" +
            "   Our 'Watchdog' system will detect it and give you new ones in about 5 seconds.\n\n" +
            "(These are known Horizon bugs being worked around. Thanks for your patience!)"
        );
    }
  }
}

hz.Component.register(Notes);
