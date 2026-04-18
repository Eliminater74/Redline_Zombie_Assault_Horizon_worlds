import * as hz from 'horizon/core';
import { Events } from 'Events';

/**
 * HUD_Coriolis
 * Connects the 'Coriolis' Noesis Sample to the Zombie Game Logic.
 * 
 * BINDINGS (Mapped to Flight Instruments for Demo):
 * - Health -> Altitude (Needle)
 * - Ammo   -> Airspeed (Needle)
 */
class HUD_Coriolis extends hz.Component<typeof HUD_Coriolis> {
  static propsDefinition = {
    // Reference to the Noesis Asset (Optional if attached to same entity)
    // In Horizon, we attach the Script AND the XAML to the same entity.
  };

  // The Data Model that Noesis watches
  // Must match the "Metrics" structure in MainPage.xaml
  private viewModel = {
    Metrics: {
      Altitude: 0, // Used for Health
      Airspeed: 0, // Used for Ammo
      Heading: 0,
      Pitch: 0,
      Climb: 0
    }
  };

  start() {
    // REVERTED: User requested to disable Noesis HUD.
    // Logic commented out to restore previous state.
    /*
    this.updateUI();

    const localPlayer = this.world.getLocalPlayer();
    if (localPlayer) {
        this.connectNetworkEvent(localPlayer, Events.viewAmmo, this.onAmmo.bind(this));
        this.connectNetworkEvent(localPlayer, Events.viewHealth, this.onHealth.bind(this));
    }
    */
  }

  private onAmmo(data: { ammo: number, totalAmmo: number }) {
    /*
    this.viewModel.Metrics.Airspeed = data.ammo;
    this.updateUI();
    */
  }

  private onHealth(data: { health: number }) {
    /*
    this.viewModel.Metrics.Altitude = data.health;
    this.updateUI();
    */
  }

  private updateUI() {
    /*
    const ui = this.entity as any;
    const forcedContext = {
      Metrics: { ...this.viewModel.Metrics }
    };
    ui.dataContext = forcedContext;
    ui.model = forcedContext;
    */
  }
}

hz.Component.register(HUD_Coriolis);
