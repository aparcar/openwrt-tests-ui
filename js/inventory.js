// The recent runs and what they tell about devices and labs, shared by the
// views (one cached request, see api.recentJobs).

import { healthReports, recentJobs } from "./api.js";
import { byNewest, deviceHealth, inventory, isOfficial, toRun } from "./model.js";

export async function recent(state) {
  // newest first (Maestro returns them in creation order)
  // without discarded runs (`owci discard`, e.g. hardware faults)
  const runs = (await recentJobs()).map(toRun).filter((r) => !r.discarded).sort(byNewest);
  const pools = state.config.pool ? [state.config.pool] : [];
  // official: the nightly schedule's runs (overview, lab statistics)
  const official = runs.filter((r) => isOfficial(r, state.config.official));
  return { runs, official, ...inventory(runs, state.labsInfo, pools) };
}

// The labs' devices and their health (lab -> platform -> report)
export const health = async () => deviceHealth(await healthReports());
