// Labs: who ran which devices in the last recent_days, whether they are
// active, and how many runs ended in lab problems (incomplete) rather than
// results. Labs come from the jobs; data/labs.json (optional) adds details.

import { recent } from "../inventory.js";
import { labOf, labStats, status } from "../model.js";
import { emptyState, h, link, mount, route, statusBadge, timeAgo } from "../ui.js";

export async function labsView(root, state) {
  const selected = route().query.get("lab");
  const days = state.config.recent_days || 14;
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const inv = await recent(state);
  const labs = [...inv.labs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const waiting = inv.runs.filter((r) => !labOf(r, inv.pools) && status(r) === "queued").length;

  mount(root,
    h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Labs"),
        h("p", { class: "lede" }, `Official runs of the last ${days} days. Incomplete runs are lab problems `
          + "(device not booting, no connection), not firmware results."))),
    waiting ? h("p", { class: "muted summary-line" }, `${waiting} run${waiting === 1 ? "" : "s"} waiting in the pool for a lab with the device.`) : null,
    labs.length === 0
      ? emptyState("No labs yet", `No lab ran a job in the last ${days} days.`)
      : h("div", { class: "lab-grid" }, labs.map((lab) => labCard(lab, inv, lab.name === selected))));

  document.getElementById(`lab-${selected}`)?.scrollIntoView({ block: "center" });
}

function labCard(lab, inv, selected) {
  // statistics and devices from official runs; manual ones only counted
  const runs = inv.official.filter((r) => labOf(r, inv.pools) === lab.name);
  const manual = inv.runs.filter((r) => labOf(r, inv.pools) === lab.name).length - runs.length;
  const stats = labStats(runs);
  const platforms = [...new Set(runs.map((r) => r.platform))]
    .sort((a, b) => deviceName(inv, a).localeCompare(deviceName(inv, b)));
  return h("article", { class: `lab-card${selected ? " selected" : ""}`, id: `lab-${lab.name}` },
    h("header", { class: "lab-head" },
      h("h2", {}, lab.name),
      stats.last ? h("span", { class: "muted" }, "active ", timeAgo(stats.last)) : h("span", { class: "muted" }, "no recent runs")),
    lab.description ? h("p", {}, lab.description) : null,
    lab.maintainer ? h("p", { class: "muted" }, "Maintained by ",
      lab.url ? h("a", { href: lab.url }, lab.maintainer) : lab.maintainer) : null,
    stats.finished ? h("div", { class: "lab-stats" },
      ["pass", "fail", "incomplete", "running"].filter((st) => stats.counts[st])
        .map((st) => statusBadge(st, { extra: h("strong", {}, ` ${stats.counts[st]}`) })),
      stats.infraRate > 0.25 ? h("span", { class: "chip warn", title: "Share of finished runs that were incomplete" },
        `${Math.round(stats.infraRate * 100)}% lab problems`) : null) : null,
    manual ? h("p", { class: "muted" }, h("a", { href: link(["manual"], { lab: lab.name }) },
      `${manual} manual run${manual === 1 ? "" : "s"}`)) : null,
    h("h3", {}, `${platforms.length} device${platforms.length === 1 ? "" : "s"}`),
    platforms.length ? h("ul", { class: "lab-devices" }, platforms.map((p) => {
      const last = runs.find((r) => r.platform === p); // runs are newest first
      return h("li", {},
        h("a", { href: link(["device", p]) }, deviceName(inv, p)),
        h("a", { href: link(["run", last.id]), class: "last" }, statusBadge(status(last), { compact: true }), " ", timeAgo(last.created)));
    })) : null,
    platforms.length ? h("a", { class: "more", href: link([], { lab: lab.name }) }, "Show in the device matrix →") : null);
}

const deviceName = (inv, platform) => inv.devices.get(platform)?.name || platform;
