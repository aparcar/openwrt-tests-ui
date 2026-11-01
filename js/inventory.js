// The recent runs and what they tell about devices and labs, shared by the
// views (one cached request, see api.recentJobs).

import { recentJobs } from "./api.js";
import { byNewest, inventory, isOfficial, toRun } from "./model.js";

export async function recent(state) {
  // newest first (Maestro returns them in creation order)
  const runs = (await recentJobs()).map(toRun).sort(byNewest);
  const pools = state.config.pool ? [state.config.pool] : [];
  // official: the nightly schedule's runs (overview, lab statistics)
  const official = runs.filter((r) => isOfficial(r, state.config.official));
  return { runs, official, ...inventory(runs, state.labsInfo, pools) };
}
