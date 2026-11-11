import { purgeServerDatabases } from "./dbhost.js";
import { withSchedules } from "./scheduler.js";

/** Removes everything tied to a deleted server: databases on the host and its schedules. */
export async function cleanupServerData(serverId: string) {
  await purgeServerDatabases(serverId).catch(e => console.warn("[cleanup] databases:", e?.message));
  await withSchedules(all => {
    for (let i = all.length - 1; i >= 0; i--) if (all[i].serverId === serverId) all.splice(i, 1);
  }).catch(() => {});
}
