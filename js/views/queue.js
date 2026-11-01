// Queue: jobs that are not done yet. Running ones (a lab claimed them) and
// waiting ones per device; a device no lab ran recently will most likely
// wait until Maestro times the job out (then it shows as incomplete).

import { unfinishedJobs } from "../api.js";
import { recent } from "../inventory.js";
import { labOf, laneLabel, queue, toRun } from "../model.js";
import { emptyState, h, link, manualBadge, mount, statusBadge, timeAgo, stackTable } from "../ui.js";

export async function queueView(root, state) {
  const days = state.config.recent_days || 14;
  mount(root, h("p", { class: "muted" }, "Loading queue…"));
  const [jobs, inv] = await Promise.all([unfinishedJobs(), recent(state)]);
  const q = queue(jobs.map(toRun), inv);
  const name = (platform) => inv.devices.get(platform)?.name || platform;
  const orphans = q.waiting.filter((g) => g.noLab);

  mount(root,
    h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Queue"),
        h("p", { class: "lede" }, q.total
          ? `${q.running.length} running · ${q.total - q.running.length} waiting for a lab`
          : "Nothing scheduled right now."))),
    orphans.length ? h("div", { class: "notice n-infra", role: "status" },
      h("strong", {}, `${orphans.length} device${orphans.length === 1 ? "" : "s"} without a lab: `),
      `no lab ran ${orphans.length === 1 ? "it" : "them"} in the last ${days} days, so `
      + `${orphans.length === 1 ? "its jobs" : "their jobs"} will likely time out and show as incomplete.`) : null,

    h("section", {},
      h("h2", {}, "Running"),
      q.running.length === 0 ? emptyState("Nothing running", "No lab is working on a job right now.")
        : h("div", { class: "table-wrap" }, stackTable(h("table", { class: "runs queue" },
          h("thead", {}, h("tr", {}, ["Device", "Build", "Lab", "Claimed", "Times out"].map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, q.running.map((r) => h("tr", {},
            h("td", {}, h("a", { href: link(["device", r.platform]) }, name(r.platform))),
            h("td", {}, buildCell(r), " ", manualBadge(r, state.config.official)),
            h("td", {}, h("a", { href: link(["labs"], { lab: labOf(r, inv.pools) }) }, labOf(r, inv.pools) || r.lab)),
            h("td", {}, statusBadge("running", { compact: true }), " ", timeAgo(r.updated)),
            h("td", {}, timeAgo(r.timeout))))))))),

    h("section", {},
      h("h2", {}, "Waiting"),
      q.waiting.length === 0 ? emptyState("Nothing waiting", "Every scheduled job has been picked up.")
        : h("div", { class: "table-wrap" }, stackTable(h("table", { class: "runs queue" },
          h("thead", {}, h("tr", {}, ["Device", "Builds", "Can run it", "Waiting since", "First times out"].map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, q.waiting.map((g) => {
            const labs = [...(inv.devices.get(g.platform)?.labs || [])].sort();
            const pinned = [...new Set(g.runs.map((r) => labOf(r, inv.pools)).filter(Boolean))];
            return h("tr", { class: g.noLab ? "c-incomplete orphan" : null },
              h("td", {}, h("a", { href: link(["device", g.platform]) }, name(g.platform)),
                name(g.platform) !== g.platform ? h("span", { class: "sub mono" }, g.platform) : null),
              h("td", {}, g.runs.map((r) => h("div", {}, buildCell(r), " ", manualBadge(r, state.config.official)))),
              h("td", {}, pinned.length
                ? [h("span", { class: "muted" }, "only "), pinned.map((lab) => h("a", { class: "chip", href: link(["labs"], { lab }) }, lab))]
                : labs.length ? labs.map((lab) => h("a", { class: "chip", href: link(["labs"], { lab }) }, lab))
                  : h("span", { class: "chip warn" }, "no lab")),
              h("td", {}, timeAgo(g.runs[0].created)),
              h("td", {}, timeAgo(g.runs[0].timeout)));
          })))))),
  );
}

function buildCell(r) {
  const l = laneLabel(r.lane);
  return h("a", { href: link(["run", r.id]), class: "build" },
    h("span", { class: "mono" }, r.describe), " ", h("span", { class: "muted" }, `${l.name} ${l.kind.toLowerCase()}`));
}
