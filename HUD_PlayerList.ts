import * as hz from 'horizon/core';
import * as ui from 'horizon/ui';

/**
 * Handles the Player List UI (Upper-Left Corner).
 * Displays up to 10 players with status indicators (Game, Dead, Lobby).
 */
export class HUD_PlayerList {

  // ---------------------------------------------------------
  // UI BINDINGS
  // ---------------------------------------------------------
  
  // Header text
  playerListText = new ui.Binding<string>('Players: 0');

  // Individual player slot bindings (up to 10 players)
  playerSlot0 = new ui.Binding<string>('');
  playerSlot1 = new ui.Binding<string>('');
  playerSlot2 = new ui.Binding<string>('');
  playerSlot3 = new ui.Binding<string>('');
  playerSlot4 = new ui.Binding<string>('');
  playerSlot5 = new ui.Binding<string>('');
  playerSlot6 = new ui.Binding<string>('');
  playerSlot7 = new ui.Binding<string>('');
  playerSlot8 = new ui.Binding<string>('');
  playerSlot9 = new ui.Binding<string>('');
  
  // Color bindings for each slot
  playerColor0 = new ui.Binding<string>('#00ff00');
  playerColor1 = new ui.Binding<string>('#00ff00');
  playerColor2 = new ui.Binding<string>('#00ff00');
  playerColor3 = new ui.Binding<string>('#00ff00');
  playerColor4 = new ui.Binding<string>('#00ff00');
  playerColor5 = new ui.Binding<string>('#00ff00');
  playerColor6 = new ui.Binding<string>('#00ff00');
  playerColor7 = new ui.Binding<string>('#00ff00');
  playerColor8 = new ui.Binding<string>('#00ff00');
  playerColor9 = new ui.Binding<string>('#00ff00');
  
  // Cache for optimization to avoid unnecessary string creations/updates
  private lastSlotValues: string[] = new Array(10).fill('');

  constructor(private parent: any) {}

  /**
   * Updates the player list UI based on the provided data.
   */
  onUpdatePlayerList(data: { players: Array<{ name: string, status: string }> }) {
    this.playerListText.set(`Players: ${data.players.length}`);
    
    // Get array of slot bindings
    const slots = [
      this.playerSlot0, this.playerSlot1, this.playerSlot2, this.playerSlot3, this.playerSlot4,
      this.playerSlot5, this.playerSlot6, this.playerSlot7, this.playerSlot8, this.playerSlot9
    ];
    
    // Get array of color bindings
    const colors = [
      this.playerColor0, this.playerColor1, this.playerColor2, this.playerColor3, this.playerColor4,
      this.playerColor5, this.playerColor6, this.playerColor7, this.playerColor8, this.playerColor9
    ];
    
    // Format player list and populate slots with colors
    for (let i = 0; i < slots.length; i++) {
      if (i < data.players.length) {
        const p = data.players[i];
        const statusIcon = p.status === 'Game' ? '🎮' : p.status === 'Dead' ? '💀' : '🏠';
        const shortName = p.name.length > 14 ? p.name.substring(0, 14) + '..' : p.name;
        const newSlotValue = `${statusIcon} ${shortName}`;
        
        // Optimization: Only update binding if value changed
        if (this.lastSlotValues[i] !== newSlotValue) {
             slots[i].set(newSlotValue);
             this.lastSlotValues[i] = newSlotValue;
        }
        
        // Set color based on status: Green=Game, Red=Dead, Yellow=Lobby
        if (p.status === 'Game') {
          colors[i].set('#00ff00'); // Bright green
        } else if (p.status === 'Dead') {
          colors[i].set('#ff4444'); // Bright red
        } else {
          colors[i].set('#ffff00'); // Bright yellow for Lobby
        }
      } else {
        if (this.lastSlotValues[i] !== '') {
            slots[i].set(''); // Clear empty slots
            this.lastSlotValues[i] = '';
        }
        colors[i].set('#00ff00'); // Reset color
      }
    }
  }

  /**
   * Creates the main view for the player list.
   */
  createView() {
    return ui.View({
      style: {
        position: 'absolute',
        top: 20,
        left: 20,
        padding: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 10,
        borderColor: '#444',
        borderWidth: 2,
        minWidth: 160,
        flexDirection: 'column',
      },
      children: [
        // Header
        ui.Text({
          text: this.playerListText,
          style: {
            fontSize: 16,
            color: '#00ccff',
            fontWeight: 'bold',
            fontFamily: 'Roboto-Mono',
            marginBottom: 6,
          }
        }),
        // Legend - colored, horizontal row (tight spacing)
        ui.View({
          style: {
            flexDirection: 'row',
            marginBottom: 6,
          },
          children: [
            ui.Text({
              text: '🎮Game',
              style: { fontSize: 11, color: '#00ff00', fontFamily: 'Roboto-Mono', marginRight: 8 }
            }),
            ui.Text({
              text: '💀Dead',
              style: { fontSize: 11, color: '#ff4444', fontFamily: 'Roboto-Mono', marginRight: 8 }
            }),
            ui.Text({
              text: '🏠Lobby',
              style: { fontSize: 11, color: '#ffff00', fontFamily: 'Roboto-Mono' }
            }),
          ]
        }),
        // Player slots - each on their own line with dynamic color
        this.playerSlotText(this.playerSlot0, this.playerColor0),
        this.playerSlotText(this.playerSlot1, this.playerColor1),
        this.playerSlotText(this.playerSlot2, this.playerColor2),
        this.playerSlotText(this.playerSlot3, this.playerColor3),
        this.playerSlotText(this.playerSlot4, this.playerColor4),
        this.playerSlotText(this.playerSlot5, this.playerColor5),
        this.playerSlotText(this.playerSlot6, this.playerColor6),
        this.playerSlotText(this.playerSlot7, this.playerColor7),
        this.playerSlotText(this.playerSlot8, this.playerColor8),
        this.playerSlotText(this.playerSlot9, this.playerColor9),
      ]
    });
  }
  
  private playerSlotText(slot: ui.Binding<string>, color: ui.Binding<string>) {
    return ui.Text({
      text: slot,
      style: {
        fontSize: 13,
        color: color,
        fontFamily: 'Roboto-Mono',
        height: 18,
      }
    });
  }

  dispose() {
      // Nothing specific to dispose locally as bindings are managed by UI
  }
}
