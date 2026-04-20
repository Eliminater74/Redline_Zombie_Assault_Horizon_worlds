import * as hz from 'horizon/core';

type AsyncLike = {
  setInterval(cb: () => void, ms: number): number;
  clearInterval(handle: number): void;
};

type HubComponent = {
  async: AsyncLike;
};

type HubEntry = {
  component: HubComponent;
  tick: () => void;
  tickMs: number;
  nextRunAt: number;
};

const transientEntries = new Map<string, HubEntry>();

let hubOwnerId = '';
let hubOwner: HubComponent | null = null;
let hubInterval: number | null = null;

const HUB_TICK_MS = 50;

function stopHub(): void {
  if (hubOwner !== null && hubInterval !== null) {
    try {
      hubOwner.async.clearInterval(hubInterval);
    } catch (e) { /* ignore */ }
  }
  hubInterval = null;
  hubOwner = null;
  hubOwnerId = '';
}

function startHub(ownerId: string, owner: HubComponent): void {
  stopHub();
  hubOwner = owner;
  hubOwnerId = ownerId;
  hubInterval = owner.async.setInterval(() => {
    const now = Date.now();
    transientEntries.forEach((entry) => {
      if (now < entry.nextRunAt) return;
      entry.nextRunAt = now + entry.tickMs;
      try {
        entry.tick();
      } catch (e) { /* ignore transient entity errors */ }
    });
  }, HUB_TICK_MS);
}

function ensureHub(): void {
  if (transientEntries.size === 0) {
    stopHub();
    return;
  }

  if (hubOwner !== null && hubInterval !== null && transientEntries.has(hubOwnerId)) {
    return;
  }

  let nextOwnerId = '';
  let nextOwner: HubComponent | null = null;
  transientEntries.forEach((candidateEntry, candidateId) => {
    if (nextOwner !== null) return;
    nextOwnerId = candidateId;
    nextOwner = candidateEntry.component;
  });

  if (nextOwner === null) {
    stopHub();
    return;
  }

  startHub(nextOwnerId, nextOwner);
}

// HORIZON PERFORMANCE OPTIMIZATION: Shared tick hub for short-lived spawned entities.
// This replaces many independent setInterval() loops with one shared interval across all
// registered ammo boxes, health pickups, and floating damage entities.
export function registerTransientEntityUpdate(
  id: string,
  component: HubComponent,
  tickMs: number,
  tick: () => void,
): void {
  transientEntries.set(id, {
    component,
    tick,
    tickMs,
    nextRunAt: Date.now() + tickMs,
  });
  ensureHub();
}

export function unregisterTransientEntityUpdate(id: string): void {
  transientEntries.delete(id);
  if (hubOwnerId === id) {
    stopHub();
  }
  ensureHub();
}
