import * as hz from 'horizon/core';
import * as ui from 'horizon/ui';
import { Events } from 'Events';

/**
 * Handles the Player Stats UI (Upper-Right Corner).
 * Displays Level, XP, Visits, Best Wave, Kills, and Headshots.
 */
export class HUD_PlayerStats {

  // ---------------------------------------------------------
  // UI BINDINGS
  // ---------------------------------------------------------
  statsVisits = new ui.Binding<number>(0);
  statsWave = new ui.Binding<number>(0);
  statsKills = new ui.Binding<number>(0);
  statsHeadshots = new ui.Binding<number>(0);
  statsAmmo = new ui.Binding<number>(0);
  statsVisible = new ui.Binding<boolean>(true);

  // Level System Bindings
  statsLevel = new ui.Binding<number>(0);
  statsXP = new ui.Binding<number>(0);
  statsXPProgress = new ui.Binding<number>(0); // 0-1 progress to next level
  statsXPToNext = new ui.Binding<number>(100);

  // XP Popup
  xpPopupVisible = new ui.Binding<boolean>(false);
  xpPopupText = new ui.Binding<string>('+10 XP');
  xpPopupScale = new ui.Binding<number>(1);

  // Level Up Popup
  levelUpVisible = new ui.Binding<boolean>(false);
  levelUpText = new ui.Binding<string>('LEVEL UP!');
  levelUpScale = new ui.Binding<number>(1);

  // BUG FIX: Store timer handles so dispose() can cancel them if the HUD is torn down mid-animation.
  private xpScaleTimer: number | null = null;
  private xpHideTimer: number | null = null;
  private levelUpScaleTimer: number | null = null;
  private levelUpHideTimer: number | null = null;

  constructor(private parent: any) {}

  /**
   * Sets up level event listeners for a specific player.
   * Called from HUD.ts when a player joins.
   * Matches pattern used by combos/stats - no local player check needed,
   * binding scope [player] handles it.
   */
  setupPlayerLevelEvents(player: hz.Player) {
    // XP Gain event (targeted to this player)
    const sub1 = this.parent.connectNetworkEvent(player, Events.xpGain, (data: {
      amount: number,
      reason: string,
      totalXP: number,
      level: number,
      progress: number
    }) => {
      this.statsLevel.set(data.level, [player]);
      this.statsXP.set(data.totalXP, [player]);
      this.statsXPProgress.set(data.progress, [player]);
      this.showXPPopup(`+${data.amount} XP`, player);
    });
    this.parent.registerPlayerSubscription(player, sub1);

    // Level Up event (targeted to this player)
    const sub2 = this.parent.connectNetworkEvent(player, Events.levelUp, (data: {
      oldLevel: number,
      newLevel: number,
      totalXP: number
    }) => {
      this.showLevelUpPopup(data.newLevel, player);
    });
    this.parent.registerPlayerSubscription(player, sub2);

    // Level Sync event (targeted to this player, on join)
    const sub3 = this.parent.connectNetworkEvent(player, Events.levelSync, (data: {
      level: number,
      totalXP: number,
      progress: number,
      xpToNext: number
    }) => {
      this.statsLevel.set(data.level, [player]);
      this.statsXP.set(data.totalXP, [player]);
      this.statsXPProgress.set(data.progress, [player]);
      this.statsXPToNext.set(data.xpToNext, [player]);
    });
    this.parent.registerPlayerSubscription(player, sub3);
  }

  private showXPPopup(text: string, player: hz.Player) {
    this.xpPopupText.set(text, [player]);
    this.xpPopupVisible.set(true, [player]);
    this.xpPopupScale.set(1.3, [player]);

    if (this.xpScaleTimer !== null) this.parent.async.clearTimeout(this.xpScaleTimer);
    this.xpScaleTimer = this.parent.async.setTimeout(() => {
      this.xpScaleTimer = null;
      this.xpPopupScale.set(1.0, [player]);
    }, 100);

    if (this.xpHideTimer !== null) this.parent.async.clearTimeout(this.xpHideTimer);
    this.xpHideTimer = this.parent.async.setTimeout(() => {
      this.xpHideTimer = null;
      this.xpPopupVisible.set(false, [player]);
    }, 1500);
  }

  private showLevelUpPopup(newLevel: number, player: hz.Player) {
    this.levelUpText.set(`LEVEL ${newLevel}!`, [player]);
    this.levelUpVisible.set(true, [player]);
    this.levelUpScale.set(1.5, [player]);

    if (this.levelUpScaleTimer !== null) this.parent.async.clearTimeout(this.levelUpScaleTimer);
    this.levelUpScaleTimer = this.parent.async.setTimeout(() => {
      this.levelUpScaleTimer = null;
      this.levelUpScale.set(1.0, [player]);
    }, 200);

    if (this.levelUpHideTimer !== null) this.parent.async.clearTimeout(this.levelUpHideTimer);
    this.levelUpHideTimer = this.parent.async.setTimeout(() => {
      this.levelUpHideTimer = null;
      this.levelUpVisible.set(false, [player]);
    }, 3000);
  }

  /**
   * Updates the stats bindings with new data.
   */
  onUpdatePlayerStats(data: { visits: number, highestWave: number, kills: number, headshots: number, ammo: number }, player: hz.Player) {
      this.statsVisits.set(data.visits, [player]);
      this.statsWave.set(data.highestWave, [player]);
      this.statsKills.set(data.kills, [player]);
      this.statsHeadshots.set(data.headshots, [player]);
      this.statsAmmo.set(data.ammo ?? 0, [player]);
  }

  /**
   * Creates the main view for the stats panel.
   */
  createView() {
      return ui.View({
          children: [
              // Main Stats Panel
              this.createStatsPanel(),
              // XP Popup
              this.createXPPopup(),
              // Level Up Popup
              this.createLevelUpPopup(),
          ]
      });
  }

  private createStatsPanel() {
      return ui.View({
          style: {
              position: 'absolute',
              top: 110,
              right: 20,
              padding: 12,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              borderRadius: 10,
              borderColor: '#666',
              borderWidth: 2,
              minWidth: 160,
              flexDirection: 'column',
              opacity: this.statsVisible.derive(v => v ? 1 : 0),
          },
          children: [
               // Header with Level
               ui.View({
                   style: {
                       flexDirection: 'row',
                       justifyContent: 'space-between',
                       alignItems: 'center',
                       marginBottom: 8,
                   },
                   children: [
                       ui.Text({
                           text: 'YOUR STATS',
                           style: {
                               fontSize: 14,
                               color: '#FFD700',
                               fontWeight: 'bold',
                               fontFamily: 'Roboto-Mono',
                           }
                       }),
                       ui.Text({
                           text: this.statsLevel.derive(l => `LV.${l}`),
                           style: {
                               fontSize: 14,
                               color: '#00FF00',
                               fontWeight: 'bold',
                               fontFamily: 'Roboto-Mono',
                           }
                       }),
                   ]
               }),

               // XP Progress Bar
               this.xpProgressBar(),

               // Visits
               this.statRow('Visits', this.statsVisits, '#FFFFFF'),

               // Highest Wave
               this.statRow('Best Wave', this.statsWave, '#00FFFF'),

               // Kills
               this.statRow('Kills', this.statsKills, '#FF4444'),

               // Headshots
               this.statRow('Headshots', this.statsHeadshots, '#FFA500'),

               // Ammo Pickups
               this.statRow('Ammo Picked', this.statsAmmo, '#44AAFF'),
          ]
      });
  }

  private xpProgressBar() {
      return ui.View({
          style: {
              width: '100%',
              height: 12,
              backgroundColor: '#333',
              borderRadius: 6,
              marginBottom: 8,
              overflow: 'hidden',
          },
          children: [
              ui.View({
                  style: {
                      height: '100%',
                      backgroundColor: '#00FF00',
                      borderRadius: 6,
                      width: this.statsXPProgress.derive(p => `${Math.max(0, Math.min(1, p)) * 100}%`),
                  }
              }),
              ui.Text({
                  text: this.statsXP.derive(xp => `${xp} XP`),
                  style: {
                      position: 'absolute',
                      width: '100%',
                      textAlign: 'center',
                      fontSize: 8,
                      color: '#FFFFFF',
                      fontFamily: 'Roboto-Mono',
                  }
              }),
          ]
      });
  }

  private createXPPopup() {
      return ui.View({
          style: {
              position: 'absolute',
              top: '40%',
              right: 50,
              display: this.xpPopupVisible.derive(v => v ? 'flex' : 'none'),
          },
          children: [
              ui.Text({
                  text: this.xpPopupText,
                  style: {
                      fontSize: 24,
                      color: '#00FF00',
                      fontWeight: 'bold',
                      fontFamily: 'Roboto-Mono',
                      textShadowColor: '#000',
                      textShadowOffset: [2, 2],
                      textShadowRadius: 3,
                      transform: [{ scale: this.xpPopupScale }],
                  }
              })
          ]
      });
  }

  private createLevelUpPopup() {
      return ui.View({
          style: {
              position: 'absolute',
              top: '25%',
              width: '100%',
              alignItems: 'center',
              display: this.levelUpVisible.derive(v => v ? 'flex' : 'none'),
          },
          children: [
              ui.View({
                  style: {
                      padding: 20,
                      backgroundColor: 'rgba(0, 100, 0, 0.9)',
                      borderRadius: 15,
                      borderColor: '#00FF00',
                      borderWidth: 4,
                  },
                  children: [
                      ui.Text({
                          text: this.levelUpText,
                          style: {
                              fontSize: 48,
                              color: '#FFFFFF',
                              fontWeight: 'bold',
                              fontFamily: 'Roboto-Mono',
                              textShadowColor: '#00FF00',
                              textShadowOffset: [0, 0],
                              textShadowRadius: 10,
                              transform: [{ scale: this.levelUpScale }],
                          }
                      })
                  ]
              })
          ]
      });
  }

  private statRow(label: string, value: ui.Binding<number>, color: string) {
      return ui.View({
          style: {
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: 4,
          },
          children: [
              ui.Text({ 
                  text: label, 
                  style: { fontSize: 12, color: '#CCCCCC', fontFamily: 'Roboto-Mono' }
              }),
              ui.Text({ 
                  text: value.derive(v => v.toString()), 
                  style: { fontSize: 12, color: color, fontFamily: 'Roboto-Mono', fontWeight: 'bold' }
              })
          ]
      });
  }

  // HORIZON BUG WORKAROUND: Timer/Interval race conditions after destroy — cancel all timers in dispose().
  dispose() {
    if (this.xpScaleTimer !== null) { this.parent.async.clearTimeout(this.xpScaleTimer); this.xpScaleTimer = null; }
    if (this.xpHideTimer !== null) { this.parent.async.clearTimeout(this.xpHideTimer); this.xpHideTimer = null; }
    if (this.levelUpScaleTimer !== null) { this.parent.async.clearTimeout(this.levelUpScaleTimer); this.levelUpScaleTimer = null; }
    if (this.levelUpHideTimer !== null) { this.parent.async.clearTimeout(this.levelUpHideTimer); this.levelUpHideTimer = null; }
  }
}
