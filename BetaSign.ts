import * as hz from 'horizon/core';

class BetaSign extends hz.Component<typeof BetaSign> {
  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    
    if (textGizmo) {
      textGizmo.text.set(
        "🎮 EARLY ACCESS 🎮\n\n" +
        "Welcome! This game is still being built.\n" +
        "New features are added all the time!\n\n" +
        "If something seems broken, don't worry -\n" +
        "we're working hard to make it better.\n\n" +
        "Come back often to see what's new!"
      );
    }
  }
}

hz.Component.register(BetaSign);