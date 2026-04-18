
import * as hz from 'horizon/core';

/**
 * PlayerList Script
 * Displays a list of players currently in the world on a TextGizmo.
 * 
 * SETUP:
 * 1. Create an object (e.g., a Cube or Panel).
 * 2. Attach a 'Text Gizmo' to the object.
 * 3. Attach this 'PlayerList' script to the object.
 */
export class PlayerList extends hz.Component<typeof PlayerList> {
  static propsDefinition = {
    display: { type: hz.PropTypes.Entity }, // Optional: Drag a Text Gizmo here
  };

  start() {
    // Initial update
    this.updateList();

    // Listen for players joining or leaving
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterWorld,
      () => this.updateList()
    );

    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerExitWorld,
      () => this.updateList()
    );
  }

  updateList() {
    // 1. Try the property first (User assigned object)
    let textGizmo: hz.TextGizmo | undefined;
    
    if (this.props.display) {
        textGizmo = this.props.display.as(hz.TextGizmo);
    }
    
    // 2. Fallback to THIS object if property is empty
    if (!textGizmo) {
        textGizmo = this.entity.as(hz.TextGizmo);
    }

    if (!textGizmo) {
        // Only error if BOTH are missing
        if (this.props.display) {
             console.error("PlayerList: The object assigned to 'display' does not have a Text Gizmo!");
        } else {
             console.error("PlayerList: No TextGizmo found on this entity, and no 'display' property assigned.");
        }
        return;
    }

    const players = this.world.getPlayers();
    
    // Sort names alphabetically
    const names = players.map(p => p.name.get()).sort();
    
    const title = `Players In World (${players.length}):\n`;
    const list = names.join('\n');
    
    textGizmo.text.set(title + list);
  }
}

hz.Component.register(PlayerList);
