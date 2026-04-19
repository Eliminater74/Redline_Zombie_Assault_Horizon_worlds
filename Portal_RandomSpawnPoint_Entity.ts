import { Component, SpawnPointGizmo } from "horizon/core";
import { portal_Data } from "Portal_Data";


class Portal_RandomSpawnPoint_Entity extends Component<typeof Portal_RandomSpawnPoint_Entity> {
  static propsDefinition = {};

  start() {
    // HORIZON BUG WORKAROUND: Missing null checks on .as() results — validate before use.
    const spawnPoint = this.entity.as(SpawnPointGizmo);
    if (!spawnPoint) {
      console.error("[Portal_RandomSpawnPoint_Entity] Entity is not a SpawnPointGizmo!");
      return;
    }

    if (!portal_Data.randomSpawnPointArray.includes(spawnPoint)) {
      portal_Data.randomSpawnPointArray.push(spawnPoint);
    }
  }

  preDestroy(): void {
    // Remove from global array on destroy — prevents stale references accumulating over sessions.
    const spawnPoint = this.entity.as(SpawnPointGizmo);
    if (!spawnPoint) return;
    const idx = portal_Data.randomSpawnPointArray.indexOf(spawnPoint);
    if (idx > -1) portal_Data.randomSpawnPointArray.splice(idx, 1);
  }
}
Component.register(Portal_RandomSpawnPoint_Entity);