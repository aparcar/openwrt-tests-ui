// Manual runs: everything not created by the nightly schedule (developers'
// and CI systems' `owci schedule`), newest first, with who asked and why.
// Filters: ?by=<user>, ?lab=<lab>.

import { recent } from "../inventory.js";
import { isOfficial, labOf, laneLabel, safeUrl, status } from "../model.js";
import { emptyState, h, link, mount, route, setQuery, statusBadge, timeAgo, stackTable } from "../ui.js";

export async function manualView(root, state) {
  const days = state.config.recent_days || 14;
  const query = route().query;
  const filters = { by: query.get("by") || "", lab: query.get("lab") || "" };
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const inv = await recent(state);
  const manual = inv.runs.filter((r) => !isOfficial(r, state.config.official));
  const users = [...new Set(manual.map((r) => r.owner).filter(Boolean))].sort();
  const labs = [...new Set(manual.map((r) => labOf(r, inv.pools)).filter(Boolean))].sort();
  const tableHost = h("div");

  const update = (key, value) => {
    filters[key] = value;
    setQuery(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
    render();
  };
  const select = (label, key, options) => h("label", { class: "field" },
    h("span", { class: "sr-only" }, label),
    h("select", { onchange: (e) => update(key, e.target.value) },
      h("option", { value: "" }, `All ${label.toLowerCase()}`),
      options.map((o) => h("option", { value: o, selected: filters[key] === o }, o))));

  function render() {
    const runs = manual.filter((r) => (!filters.by || r.owner === filters.by)
      && (!filters.lab || labOf(r, inv.pools) === filters.lab));
    mount(tableHost, runs.length === 0
      ? emptyState("No manual runs", `Nobody scheduled a run by hand in the last ${days} days. `
        + "Each device page shows the command for it.")
      : h("div", { class: "table-wrap" }, stackTable(h("table", { class: "runs queue" },
        h("thead", {}, h("tr", {}, ["Result", "What", "By", "Device", "Build", "Lab", "Started"]
          .map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, runs.map((r) => {
          const l = laneLabel(r.lane);
          const url = safeUrl(r.trigger.url);
          return h("tr", {},
            h("td", {}, h("a", { href: link(["run", r.id]) }, statusBadge(status(r)))),
            h("td", {}, h("a", { href: link(["run", r.id]) }, r.trigger.title || "untitled"),
              url ? [" ", h("a", { href: url, class: "muted" }, "↗")] : null),
            h("td", {}, h("a", { href: link(["manual"], { by: r.owner }) }, r.owner || "—")),
            h("td", {}, h("a", { href: link(["device", r.platform]) }, inv.devices.get(r.platform)?.name || r.platform)),
            h("td", {}, h("span", { class: "mono" }, r.describe), " ",
              h("span", { class: "muted" }, `${l.name} ${l.kind.toLowerCase()}`)),
            h("td", {}, labOf(r, inv.pools) || h("span", { class: "muted" }, "waiting")),
            h("td", {}, timeAgo(r.created)));
        }))))));
  }

  mount(root,
    h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Manual runs"),
        h("p", { class: "lede" }, `Runs scheduled by hand or by CI systems in the last ${days} days. `
          + "They are not part of the official results (the device overview and lab statistics)."))),
    users.length > 1 || labs.length > 1 ? h("div", { class: "toolbar" },
      users.length > 1 ? select("People", "by", users) : null,
      labs.length > 1 ? select("Labs", "lab", labs) : null) : null,
    tableHost);
  render();
}
