/**
 * WEAPON CONFIGURATION
 * Centralizes all balance stats for weapons.
 */

export interface WeaponData {
  displayName: string;
  magSize: number;
  reloadTimeS: number;
  shootDelayS: number;
  damage: number;
  totalAmmo: number;
  auto: boolean;
}

const pistol: WeaponData = {
  displayName: 'Pistol',
  magSize: 15,
  reloadTimeS: 0.52,
  shootDelayS: 0.15,
  damage: 48,
  totalAmmo: 90,
  auto: false
};

const submachineGun: WeaponData = {
  displayName: 'Submachine Gun',
  magSize: 25,
  reloadTimeS: 0.86,
  shootDelayS: 0.086,
  damage: 29,
  totalAmmo: 150,
  auto: true
};

const LMG: WeaponData = {
  displayName: 'SAW',
  magSize: 70,
  reloadTimeS: 4.01,
  shootDelayS: 0.07,
  damage: 10,
  totalAmmo: 420,
  auto: true
};

const assaultRifle: WeaponData = {
  displayName: 'Assault Rifle',
  magSize: 50,
  reloadTimeS: 1.41,
  shootDelayS: 0.092,
  damage: 24,
  totalAmmo: 180,
  auto: true
};

const Sniper: WeaponData = {
  displayName: 'Sniper',
  magSize: 5,
  reloadTimeS: 1.75,
  shootDelayS: 0.5,
  damage: 144,
  totalAmmo: 30,
  auto: false
};

// Map ID to Data
export const WeaponConfig = new Map<number, WeaponData>([
  [0, pistol],
  [1, submachineGun],
  [2, LMG],
  [3, assaultRifle],
  [4, Sniper]
]);

// Default backup
export const DefaultWeapon = assaultRifle;
