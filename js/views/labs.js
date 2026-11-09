// Labs: their devices and each device's health (the labs' own health
// reports, like LAVA's device list), the latest official run per device, and
// how many runs ended in lab problems (incomplete) rather than results. Labs
// come from the health reports and the jobs; data/labs.json (optional) adds
// details and hides retired labs.

import { fetchText, node } from "../api.js";
import { health, recent } from "../inventory.js";
import { HEALTH_MAX_AGE_H, healthReason, labOf, labStats, status, toHealth } from "../model.js";
import { emptyState, h, healthBadge, link, mount, route, stackTable, statusBadge, timeAgo } from "../ui.js";
import { logView } from "./run.js";

export async function labsView(root, state) {
  const selected = route().query.get("lab");
  const days = state.config.recent_days || 14;
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const [inv, labHealth] = await Promise.all([recent(state), health()]);
  for (const name of labHealth.keys()) {
    if (!inv.labs.has(name) && !state.labsInfo[name]?.retired) inv.labs.set(name, { name, ...(state.labsInfo[name] || {}), platforms: new Set() });
  }
  const labs = [...inv.labs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const waiting = inv.runs.filter((r) => !labOf(r, inv.pools) && status(r) === "queued").length;

  mount(root,
    h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Labs"),
        h("p", { class: "lede" }, "Each lab reports its devices and their health; only healthy devices get "
          + `new runs. Run statistics: official runs of the last ${days} days. Incomplete runs are lab problems `
          + "(device not booting, no connection), not firmware results."))),
    waiting ? h("p", { class: "muted summary-line" }, `${waiting} run${waiting === 1 ? "" : "s"} waiting in the pool for a lab with the device.`) : null,
    labs.length === 0
      ? emptyState("No labs yet", `No lab reported a device or ran a job in the last ${days} days.`)
      : h("div", { class: "lab-list" }, labs.map((lab) =>
        labCard(lab, inv, labHealth.get(lab.name) || new Map(), lab.name === selected))));

  document.getElementById(`lab-${selected}`)?.scrollIntoView({ block: "center" });
}

function labCard(lab, inv, devices, selected) {
  // statistics from official runs; manual ones only counted
  const runs = inv.official.filter((r) => labOf(r, inv.pools) === lab.name);
  const manual = inv.runs.filter((r) => labOf(r, inv.pools) === lab.name).length - runs.length;
  const stats = labStats(runs);
  // devices: the lab's health reports, plus devices it ran without reporting
  // them (agents from before the reports); unavailable ones first
  const available = (p) => devices.get(p)?.schedulable ?? true;
  const platforms = [...new Set([...devices.keys(), ...runs.map((r) => r.platform)])]
    .sort((a, b) => available(a) - available(b) || deviceName(inv, a).localeCompare(deviceName(inv, b)));
  const lastReport = [...devices.values()].map((d) => d.created).sort().pop();
  const last = [stats.last, lastReport].filter(Boolean).sort().pop();
  const problems = platforms.filter((p) => !available(p)).length;
  return h("section", { class: `lab-card${selected ? " selected" : ""}`, id: `lab-${lab.name}` },
    h("header", { class: "lab-head" },
      h("div", {},
        h("h2", {}, lab.name),
        lab.description || lab.maintainer ? h("p", { class: "muted" },
          lab.description || null, lab.description && lab.maintainer ? " · " : null,
          lab.maintainer ? ["Maintained by ", lab.url ? h("a", { href: lab.url }, lab.maintainer) : lab.maintainer] : null) : null),
      h("div", { class: "lab-stats" },
        h("span", { class: "muted" }, last ? ["active ", timeAgo(last)] : "no recent activity"),
        ["pass", "fail", "incomplete", "running"].filter((st) => stats.counts[st])
          .map((st) => statusBadge(st, { extra: h("strong", {}, ` ${stats.counts[st]}`) })),
        stats.infraRate > 0.25 ? h("span", { class: "chip warn", title: "Share of finished runs that were incomplete" },
          `${Math.round(stats.infraRate * 100)}% lab problems`) : null,
        manual ? h("a", { class: "muted", href: link(["manual"], { lab: lab.name }) },
          `${manual} manual run${manual === 1 ? "" : "s"}`) : null)),
    h("p", { class: "lab-summary" },
      h("strong", {}, `${platforms.length} device${platforms.length === 1 ? "" : "s"}`),
      problems ? [" · ", h("span", { class: "t-fail" }, `${problems} not available`)] : null,
      platforms.length ? [" · ", h("a", { href: link([], { lab: lab.name }) }, "device matrix →")] : null),
    platforms.length ? h("div", { class: "table-wrap flat" }, stackTable(h("table", { class: "lab-devices" },
      h("thead", {}, h("tr", {}, ["Device", "Health", "Checked", "Note", "Last run"].map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", {}, platforms.map((p) => deviceRow(inv, p, devices.get(p), runs.find((r) => r.platform === p))))))) : null);
}

// One device of a lab: its health report (if any) and its latest official
// run (runs are newest first)
function deviceRow(inv, platform, report, last) {
  return h("tr", {},
    h("td", {}, h("a", { href: link(["device", platform]) }, deviceName(inv, platform))),
    h("td", {}, report ? healthBadge(report) : h("span", { class: "muted" }, "—")),
    h("td", {}, report ? [timeAgo(report.created), report.check?.release
      ? h("span", { class: "sub" }, report.check.release) : null] : h("span", { class: "muted" }, "—")),
    h("td", { class: "note" }, report ? healthNote(report) : null),
    h("td", {}, last
      ? h("a", { href: link(["run", last.id]) }, statusBadge(status(last), { compact: true }), " ", timeAgo(last.created))
      : h("span", { class: "muted" }, "no runs")));
}

const deviceName = (inv, platform) => inv.devices.get(platform)?.name || platform;

// Why a device is not available or not checked, and the check's log
export function healthNote(report) {
  const reason = report.offline ? `no report for ${HEALTH_MAX_AGE_H} h` : healthReason(report.reason);
  return [reason ? h("span", { class: report.offline || report.result === "fail" ? "t-fail" : "muted" }, reason) : null,
    report.log ? [reason ? " · " : null, h("a", { href: link(["health", report.id]) }, "log")] : null];
}

// A health check's files, shown in the page (#/health/<node id>[/<key>]):
// storage sends everything as a download
const HEALTH_FILES = { test_log: "Console log", pytest_log: "pytest output", junit: "JUnit XML" };

export async function healthLogView(root, state, id, key = "test_log") {
  mount(root, h("p", { class: "muted" }, "Loading log…"));
  const job = await node(id);
  const report = toHealth(job);
  const artifacts = job.artifacts || {};
  const label = HEALTH_FILES[key] || key;
  const url = artifacts[key];
  // without a console log the agent sends pytest's output as test_log
  const others = Object.keys(HEALTH_FILES)
    .filter((k) => k !== key && artifacts[k] && artifacts[k] !== url)
    .map((k) => h("a", { class: "file", href: link(["health", id, k]) }, HEALTH_FILES[k]));
  const head = [
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
      h("a", { href: link(["labs"]) }, "Labs"), " / ",
      h("a", { href: link(["labs"], { lab: report.lab }) }, report.lab), " / ",
      h("a", { href: link(["device", report.platform]) }, report.platform), " / ",
      h("span", {}, "Health check")),
  ];
  if (!url) {
    mount(root, ...head, emptyState(`No ${label.toLowerCase()}`, "This health check has no such file."));
    return;
  }
  const text = await fetchText(url);
  mount(root, ...head,
    h("header", { class: "page-head" }, h("div", {},
      h("h1", {}, `Health check: ${label}`),
      h("p", { class: "lede" }, statusBadge(report.result), " ",
        `${report.platform} · ${report.lab}${report.place ? ` (${report.place})` : ""} · `,
        timeAgo(report.created),
        report.check?.release ? ` · ${report.check.release}` : "",
        ` · ${text.split("\n").length} lines`),
      others.length ? h("p", { class: "file-links" }, others) : null)),
    logView(text, url, { full: true }));
}
