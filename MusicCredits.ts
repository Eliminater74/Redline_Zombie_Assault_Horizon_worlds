import * as hz from 'horizon/core';

/**
 * MusicCredits
 * Displays the list of songs written by Eliminater74 on a TextGizmo.
 */
class MusicCredits extends hz.Component<typeof MusicCredits> {
  static propsDefinition = {
    textColor: { type: hz.PropTypes.Color, default: new hz.Color(0.0, 0.5, 1.0) }, // Default Blue
    fontSize: { type: hz.PropTypes.Number, default: 24 },
  };

  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    if (!textGizmo) {
      console.error("MusicCredits must be attached to a Text Gizmo!");
      return;
    }

    const header = "**Music Written Solely by Eliminater74**";
    
    const songs = [
      "1. Full Throttle (Don't Look Back)",
      "2. Zombie Assault (Official Theme)",
      "3. Redline: Zombie Assault (Infinite Waves)",
      "4. Redline: Zombie Assault (Top Dog)",
      "5. Redline: Zombie Assault (The Last Stand)",
      "6. Redline: Zombie Assault (Feed The Machine)",
      "7. Redline: Zombie Assault (Seven Times The Fury)",
      "8. Redline: Zombie Assault (The Multiplier)",
      "9. Redline: Zombie Assault (Cell Block 15)",
      "10. Redline: Zombie Assault (The Master Guide)",
      "11. Redline: Zombie Assault (Midnight Run)",
      "12. Redline: Zombie Assault (The Green Tide)",
      "13. The Redline Rumble (Monster Mash 2.0)",
      "14. The Architect (Eliminater's Shadow)",
      "15. You Snooze, You Lose (The Creator's Blues)",
      "16. System Override (The Coder & The Builder)",
      "17. The Legend of BummerTown (The Swipe)",
      "18. Redline: Dead Man's Party",
      "19. Empty Clips (Ghost in the Lobby)"
    ];

    const footer = "***\n\n**Processed through: iZotope RX 11 Advanced Audio Editor**\n*All rights owned by Eliminater74.*";

    // Combine into final string
    const finalString = header + "\n\n" + songs.join("\n") + "\n\n" + footer;

    // Apply settings
    textGizmo.text.set(finalString);
    textGizmo.color.set(this.props.textColor);
    
    // Note: FontSize is best controlled by scaling the Gizmo or setting it in the Property Panel directly.
    // textGizmo.fontSize.set(this.props.fontSize);
  }
}

hz.Component.register(MusicCredits);
