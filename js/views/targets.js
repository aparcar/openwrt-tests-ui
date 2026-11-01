// Target coverage: every OpenWrt target (config.targets) and the devices
// that ran on it in the last recent_days (official and manual runs), to
// find targets without a device and pick the next one to add. A missing
// target on an architecture no device covers yet counts the most.
// Filters: ?show=missing|covered, ?q=<text>.

import { recent } from "../inventory.js";
import { targetCoverage } from "../model.js";
import { emptyState, h, link, mount, route, setQuery, stackTable } from "../ui.js";

export async function targetsView(root, state) {
  const days = state.config.recent_days || 14;
  const query = route().query;
  const filters = { show: query.get("show") || "all", q: query.get("q") || "" };
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const inv = await recent(state);
  const cov = targetCoverage(state.config.targets, [...inv.devices.values()]);
  const s = cov.summary;
  const tableHost = h("div", { class: "table-wrap" });
  const summaryHost = h("p", { class: "muted summary-line" });

  const update = (key, value) => {
    filters[key] = value;
    const q = {};
    if (filters.show !== "all") q.show = filters.show;
    if (filters.q) q.q = filters.q;
    setQuery(q);
    render();
  };

  const showOptions = [["all", "All"], ["missing", "Missing"], ["covered", "Covered"]];

  mount(root,
    h("header", { class: "page-head" },
      h("div", {},
        h("h1", {}, "Targets"),
        h("p", { class: "lede" }, `OpenWrt targets and the devices that ran on them in the last ${days} days. `
          + "Missing targets on an architecture without any device are the most useful to add next."))),
    h("div", { class: "coverage-stats" },
      stat("Targets", s.covered, s.targets),
      stat("Subtargets", s.coveredSubtargets, s.subtargets),
      stat("Architectures", s.coveredArches, s.arches)),
    !state.config.targets ? h("p", { class: "error" }, "No targets in data/config.json, only those of the runs are listed.") : null,
    h("div", { class: "toolbar", role: "search" },
      h("label", { class: "field grow" },
        h("span", { class: "sr-only" }, "Search targets"),
        h("input", {
          type: "search", placeholder: "Search target, architecture or device…", value: filters.q,
          oninput: (e) => update("q", e.target.value),
        })),
      h("div", { class: "segmented", role: "group", "aria-label": "Filter by coverage" },
        showOptions.map(([value, label]) =>
          h("button", {
            type: "button", class: filters.show === value ? "active" : null, "aria-pressed": String(filters.show === value),
            onclick: (e) => {
              e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", b === e.currentTarget);
                b.setAttribute("aria-pressed", String(b === e.currentTarget));
              });
              update("show", value);
            },
          }, label)))),
    summaryHost,
    tableHost,
    cov.unknown.length ? h("p", { class: "muted summary-line" },
      `Not counted (no target in their runs yet): `,
      cov.unknown.map((d, i) => [i ? ", " : "", h("a", { href: link(["device", d.platform]) }, d.name)])) : null);

  function render() {
    const q = filters.q.toLowerCase();
    const visible = cov.targets.filter((t) => {
      if (filters.show === "missing" && t.covered) return false;
      if (filters.show === "covered" && !t.covered) return false;
      if (!q) return true;
      return [t.name, ...t.arches, ...t.subtargets.map((st) => st.name), ...t.devices.flatMap((d) => [d.name, d.platform])]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
    summaryHost.textContent = `${s.targets - s.covered} of ${s.targets} targets without a device · showing ${visible.length}`;
    mount(tableHost, visible.length === 0
      ? emptyState("No matching targets", "Change the search or filter.")
      : stackTable(h("table", { class: "targets" },
        h("thead", {}, h("tr", {}, ["Target", "Subtargets", "Architectures", "Devices"]
          .map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, visible.map((t) => targetRow(t, cov.coveredArches))))));
  }

  render();
}

function stat(label, covered, total) {
  return h("div", { class: "coverage-stat" },
    h("span", { class: "coverage-num" }, String(covered), h("span", { class: "muted" }, ` / ${total}`)),
    h("span", { class: "muted" }, `${label} covered`),
    h("span", { class: "bar", "aria-hidden": "true" },
      h("span", { class: "seg s-pass", style: `width:${total ? (100 * covered) / total : 0}%` })));
}

function targetRow(t, coveredArches) {
  // a missing target whose architectures no device covers yet
  const newArch = !t.covered && t.arches.length > 0 && t.arches.every((a) => !coveredArches.has(a));
  return h("tr", { class: t.covered ? "covered" : "missing" },
    h("th", { scope: "row" },
      h("span", { class: "target-name" }, t.name),
      t.covered
        ? h("span", { class: "sub t-pass" }, "✓ covered")
        : h("span", { class: "sub t-fail" }, "✕ no device"),
      newArch ? h("span", { class: "sub t-warn", title: "No device on any of its architectures" }, "new architecture") : null,
      t.subtargets.some((st) => st.extra) ? h("span", { class: "sub", title: "Not in data/config.json" }, "not in config") : null),
    h("td", {}, coverageList(t.subtargets.map((st) => ({
      text: st.name.split("/")[1] || st.name,
      on: st.devices.length > 0,
      title: `${st.name}${st.arch ? ` (${st.arch})` : ""}: ${st.devices.length} device${st.devices.length === 1 ? "" : "s"}`,
    })))),
    h("td", {}, coverageList(t.arches.map((a) => ({ text: a, on: coveredArches.has(a), mono: true })))),
    h("td", {}, t.devices.length
      ? h("ul", { class: "target-devices" }, t.devices.map((d) => h("li", {},
        h("a", { href: link(["device", d.platform]) }, d.name),
        h("span", { class: "muted" }, ` ${d.target.split("/")[1] || ""}`))))
      : h("span", { class: "muted" }, "—")));
}

// covered entries with a check mark, the others muted
function coverageList(items) {
  return h("ul", { class: "coverage-list" }, items.map((i) =>
    h("li", { class: `${i.on ? "on" : "muted"}${i.mono ? " mono" : ""}`, title: i.title || null },
      h("span", { class: "mark", "aria-hidden": "true" }, i.on ? "✓" : ""),
      i.text, i.on ? h("span", { class: "sr-only" }, " (covered)") : null)));
}
