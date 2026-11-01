// One device: what it is, which labs ran it, and its run history per build
// lane (branch × release/snapshot), newest first. All from its jobs.

import { jobsForPlatform } from "../api.js";
import { compareLanes, duration, groupByLane, inventory, labOf, laneLabel, releasesOf, status, toRun } from "../model.js";
import { countsBar, emptyState, h, link, manualBadge, mount, statusBadge, timeAgo, stackTable } from "../ui.js";
import { scheduleBox } from "./schedule.js";

export async function deviceView(root, state, platform) {
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const runs = (await jobsForPlatform(platform, 100)).map(toRun);
  const inv = inventory(runs, {}, state.config.pool ? [state.config.pool] : []);
  const device = inv.devices.get(platform) || { name: platform, features: [] };
  const labs = [...(device.labs || [])].sort();
  const listHost = h("div");

  mount(root,
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: link([]) }, "Devices"), " / ", h("span", {}, device.name)),
    h("header", { class: "page-head" },
      h("div", {},
        h("h1", {}, device.name),
        h("p", { class: "lede" },
          h("span", { class: "mono" }, platform),
          device.target ? [" · ", h("span", { class: "mono" }, `${device.target}/${device.profile || ""}`)] : null))),
    h("section", { class: "facts" },
      h("div", { class: "fact" }, h("span", { class: "fact-label" }, "Labs"),
        h("span", { class: "fact-value" }, labs.length
          ? labs.map((lab) => h("a", { class: "chip", href: link(["labs"], { lab }) }, lab))
          : h("span", { class: "muted" }, "none"))),
      device.features?.length ? h("div", { class: "fact" }, h("span", { class: "fact-label" }, "Features"),
        h("span", { class: "fact-value" }, device.features.map((f) => h("span", { class: "chip plain" }, f)))) : null),
    scheduleBox({ title: "Schedule a run", device: platform, releases: releasesOf(runs), labs }),
    listHost);

  if (runs.length === 0) {
    mount(listHost, emptyState("No runs yet", "Nothing has been scheduled for this device so far."));
    return;
  }
  const lanes = groupByLane(runs);
  mount(listHost, [...lanes.keys()].sort(compareLanes).map((lane) => {
    const l = laneLabel(lane);
    const laneRuns = lanes.get(lane);
    return h("section", { class: "lane-section" },
      h("h2", {}, l.name, " ", h("span", { class: "muted" }, l.kind),
        h("span", { class: "history", "aria-label": "Recent results, newest first" },
          laneRuns.slice(0, 20).map((r) => h("a", { class: `dot c-${status(r)}`, href: link(["run", r.id]), title: `${r.describe}: ${status(r)}` })))),
      h("div", { class: "table-wrap" },
        stackTable(h("table", { class: "runs" },
          h("thead", {}, h("tr", {},
            ["Result", "Build", "Tests", "Lab", "Duration", "Started"].map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, laneRuns.map((r) => h("tr", {},
            h("td", {}, h("a", { href: link(["run", r.id]) }, statusBadge(status(r)))),
            h("td", {}, h("a", { class: "mono", href: link(["run", r.id]) }, r.describe),
              " ", manualBadge(r, state.config.official),
              r.trigger.title ? h("span", { class: "sub" }, r.trigger.title) : null,
              r.errorMsg ? h("span", { class: "sub t-fail" }, r.errorMsg) : null),
            h("td", {}, r.summary ? countsBar(r.summary) : h("span", { class: "muted" }, "—")),
            h("td", {}, labOf(r, inv.pools) || h("span", { class: "muted" }, "waiting")),
            h("td", {}, r.durationMs != null ? duration(r.durationMs) : h("span", { class: "muted" }, "—")),
            h("td", {}, timeAgo(r.created)))))))));
  }));
}
