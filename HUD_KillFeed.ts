import * as hz from 'horizon/core';
import * as ui from 'horizon/ui';

// Circular dependency note: Using 'any' for parent to avoid circular refs securely.

/**
 * Handles the Kill Feed (Death Notifications) and Kill Counter logic.
 */
export class HUD_KillFeed {

  // ---------------------------------------------------------
  // UI BINDINGS
  // ---------------------------------------------------------
  
  // Death Notification
  deathMsg = new ui.Binding<string>('');
  deathMsgVisible = new ui.Binding<boolean>(false);
  
  // Kill Counter
  killCount = new ui.Binding<number>(0);
  
  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — use number, not number.
  private deathTimeout: number | null = null;

  constructor(private parent: { 
      async: any // Using 'any' to match the HUD's async helper (which we fixed to 'any' previously)
  }) {}

  /**
   * Called to display the Death Notification Overlay View
   */
  createDeathNotificationView() {
    return ui.View({
      style: {
        position: 'absolute', top: '15%', width: '100%', alignItems: 'center',
        opacity: this.deathMsgVisible.derive(v => v ? 1 : 0),
      },
      children: [
        ui.View({
          style: {
            backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#ff4444',
          },
          children: [
            ui.Text({
              text: this.deathMsg,
              style: {
                fontSize: 24, fontWeight: 'bold', fontFamily: 'Roboto-Mono', color: '#ff4444', textAlign: 'center',
              }
            })
          ]
        })
      ]
    });
  }

  /**
   * Called to display the Kill Counter View (Bottom Left usually, or near ammo)
   */
  createKillCounterView() {
    return ui.View({
      style: {
        position: 'absolute', left: 32, bottom: 110, // Moved down (was 150), aligned left with Ammo (was 30)
        flexDirection: 'row', alignItems: 'center',
        padding: 10, backgroundColor: 'rgba(0, 0, 0, 0.7)', borderRadius: 8, // Darker background for contrast
        borderColor: '#444', borderWidth: 2 // Added border for definition
      },
      children: [
        ui.Text({
          text: '☠', 
          style: { fontSize: 32, color: '#ff4444', marginRight: 8 }
        }),
        ui.Text({
          text: this.killCount.derive(k => `${k}`),
          style: {
            fontSize: 32, fontFamily: 'Roboto-Mono', color: '#FFD700', fontWeight: 'bold', // Gold color for readability
            textShadowColor: '#000', textShadowOffset: [2, 2], textShadowRadius: 4,
          }
        })
      ]
    });
  }

  // ---------------------------------------------------------
  // LOGIC
  // ---------------------------------------------------------

  /**
   * Updates the kill counter.
   */
  onUpdateKillCount(data: { count: number, player: hz.Player }) {
    // Note: The parent HUD handles filtering for local player in the event listener if needed,
    // but typically bindings are local-only anyway.
    this.killCount.set(data.count, [data.player]);
  }

  refreshKillCount() {
    this.killCount.set(0); 
  }

  /**
   * Shows a death notification.
   */
  onPlayerDied(data: { name: string }) {
    // Check if it's a custom message (contains special keywords)
    if (data.name.includes('left the game') || data.name.includes('AFK LIMIT')) {
      this.deathMsg.set(data.name);
    } else {
      this.deathMsg.set(`${data.name} died!\nRespawns next wave.`);
    }
    
    this.deathMsgVisible.set(true);
    
    if (this.deathTimeout !== null) {
        this.parent.async.clearTimeout(this.deathTimeout);
    }
    
    this.deathTimeout = this.parent.async.setTimeout(() => {
      this.deathMsgVisible.set(false);
      this.deathTimeout = null;
    }, 4000);
  }
  
  dispose() {
      if (this.deathTimeout !== null) {
          this.parent.async.clearTimeout(this.deathTimeout);
      }
  }
}
