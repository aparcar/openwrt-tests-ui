// Devices overview: one row per device, one column per build lane
// (branch × release/snapshot), latest run per cell. Only official runs (the
// nightly schedule's, config.official) of the last recent_days; manual runs
// are in their own tab.

import { recent } from "../inventory.js";
import { compareLanes, groupByLane, labOf, laneCell, laneLabel, STATUS, worstStatus } from "../model.js";
import { countsBar, emptyState, h, link, mount, route, setQuery, statusBadge, timeAgo, stackTable } from "../ui.js";

const DEFAULT_LANES = 4;

export async function devicesView(root, state) {
  const { query } = route();
  mount(root, h("p", { class: "muted" }, "Loading runs…"));
  const inv = await recent(state);
  const byPlatform = new Map();
  for (const run of inv.official) {
    if (!byPlatform.has(run.platform)) byPlatform.set(run.platform, []);
    byPlatform.get(run.platform).push(run);
  }
  const devices = [...inv.devices.values()].filter((d) => byPlatform.has(d.platform))
    .map((d) => ({ ...d, labs: [...d.labs].sort() }));
  // platform -> its runs per lane and the latest run per lane
  const rows = new Map(devices.map((d) => {
    const lanes = groupByLane(byPlatform.get(d.platform) || []);
    return [d.platform, { lanes, cells: new Map([...lanes].map(([k, v]) => [k, laneCell(v)])) }];
  }));

  const filters = {
    q: query.get("q") || "",
    status: query.get("status") || "all",
    lab: query.get("lab") || "",
    sort: query.get("sort") || "status",
    all: query.get("all") === "1",
  };

  const tableHost = h("div", { class: "table-wrap" });
  const summaryHost = h("p", { class: "muted summary-line" });

  function update(key, value) {
    filters[key] = value;
    const q = {};
    if (filters.q) q.q = filters.q;
    if (filters.status !== "all") q.status = filters.status;
    if (filters.lab) q.lab = filters.lab;
    if (filters.sort !== "status") q.sort = filters.sort;
    if (filters.all) q.all = "1";
    setQuery(q);
    render();
  }

  const statusOptions = [["all", "All"], ["failing", "Failing"], ["passing", "Passing"], ["pending", "Queued / running"]];

  mount(root,
    h("header", { class: "page-head" },
      h("div", {},
        h("h1", {}, "Devices"),
        h("p", { class: "lede" }, "Latest test result per device and build. Click a result for details.")),
    ),
    h("div", { class: "toolbar", role: "search" },
      h("label", { class: "field grow" },
        h("span", { class: "sr-only" }, "Search devices"),
        h("input", {
          type: "search", placeholder: "Search device, platform or target…", value: filters.q,
          oninput: (e) => update("q", e.target.value),
        })),
      h("div", { class: "segmented", role: "group", "aria-label": "Filter by status" },
        statusOptions.map(([value, label]) =>
          h("button", {
            type: "button", class: filters.status === value ? "active" : null, "aria-pressed": String(filters.status === value),
            onclick: (e) => {
              e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", b === e.currentTarget);
                b.setAttribute("aria-pressed", String(b === e.currentTarget));
              });
              update("status", value);
            },
          }, label))),
      h("label", { class: "field" },
        h("span", { class: "sr-only" }, "Lab"),
        h("select", { onchange: (e) => update("lab", e.target.value) },
          h("option", { value: "" }, "All labs"),
          [...inv.labs.keys()].sort().map((lab) => h("option", { value: lab, selected: filters.lab === lab }, lab)))),
      h("label", { class: "field" },
        h("span", { class: "sr-only" }, "Sort"),
        h("select", { onchange: (e) => update("sort", e.target.value) },
          h("option", { value: "status", selected: filters.sort === "status" }, "Sort: problems first"),
          h("option", { value: "name", selected: filters.sort === "name" }, "Sort: name"),
          h("option", { value: "target", selected: filters.sort === "target" }, "Sort: target"))),
    ),
    summaryHost,
    tableHost,
  );

  if (devices.length === 0) {
    mount(tableHost, emptyState("No runs yet",
      `No official runs in the last ${state.config.recent_days || 14} days (see seed/schedule.py).`));
    return;
  }

  function render() {
    const allLanes = [...new Set(devices.flatMap((d) => [...rows.get(d.platform).lanes.keys()]))].sort(compareLanes);
    const lanes = filters.all ? allLanes : allLanes.slice(0, DEFAULT_LANES);

    const q = filters.q.toLowerCase();
    let visible = devices.filter((d) => {
      if (filters.lab && !d.labs.includes(filters.lab)) return false;
      if (q && ![d.name, d.platform, d.target].some((v) => (v || "").toLowerCase().includes(q))) return false;
      const row = rows.get(d.platform);
      const worst = worstStatus(lanes.map((l) => row.cells.get(l)));
      if (filters.status === "failing") return worst === "fail" || worst === "incomplete";
      if (filters.status === "passing") return worst === "pass";
      if (filters.status === "pending") return worst === "queued" || worst === "running";
      return true;
    });

    const severity = (d) => {
      const row = rows.get(d.platform);
      return STATUS[worstStatus(lanes.map((l) => row.cells.get(l)))].rank;
    };
    visible = visible.sort((a, b) => {
      if (filters.sort === "status") return severity(b) - severity(a) || a.name.localeCompare(b.name);
      if (filters.sort === "target") return (a.target || "").localeCompare(b.target || "") || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

    const failing = devices.filter((d) => ["fail", "incomplete"].includes(worstStatus(lanes.map((l) => rows.get(d.platform).cells.get(l))))).length;
    summaryHost.textContent = `${devices.length} devices with official runs in the last ${state.config.recent_days || 14} days · `
      + `${failing} with problems · showing ${visible.length}`;

    const head = h("tr", {},
      h("th", { scope: "col", class: "sticky" }, "Device"),
      lanes.map((lane) => {
        const l = laneLabel(lane);
        return h("th", { scope: "col", class: "lane", dataset: { label: `${l.name} ${l.kind}` } },
          h("span", { class: "lane-name" }, l.name), h("span", { class: "lane-kind" }, l.kind));
      }),
      h("th", { scope: "col" }, "Labs"));

    const body = visible.length === 0
      ? [h("tr", {}, h("td", { colspan: lanes.length + 2 }, emptyState("No matching devices", "Change the search or filters.")))]
      : visible.map((d) => deviceRow(d, rows.get(d.platform), lanes, inv.pools));

    const more = allLanes.length > DEFAULT_LANES
      ? h("button", { type: "button", class: "linkish", onclick: () => update("all", !filters.all) },
          filters.all ? "Show latest builds only" : `Show all ${allLanes.length} builds`)
      : null;

    mount(tableHost,
      stackTable(h("table", { class: "matrix" }, h("thead", {}, head),
        h("tbody", {}, body))),
      more);
  }

  render();
}

function deviceRow(d, row, lanes, pools) {
  const deviceCell = h("th", { scope: "row", class: "sticky device" },
    h("a", { href: link(["device", d.platform]) }, d.name),
    d.name !== d.platform ? h("span", { class: "sub mono" }, d.platform) : null,
    d.target ? h("span", { class: "sub" }, d.target) : null);
  return h("tr", {}, deviceCell,
    lanes.map((lane) => {
      const cell = row.cells.get(lane);
      if (!cell) return h("td", { class: "cell empty-cell" }, h("span", { class: "muted" }, "—"));
      const r = cell.run;
      return h("td", { class: `cell c-${cell.status}` },
        h("a", { href: link(["run", r.id]), class: "cell-link", title: `${r.describe}: ${labOf(r, pools) ? `on ${labOf(r, pools)}` : "waiting for a lab"}` },
          h("span", { class: "cell-top" }, statusBadge(cell.status),
            cell.newFailure ? h("span", { class: "chip new", title: "Passed on the previous build" }, "new") : null),
          h("span", { class: "cell-meta" }, r.summary ? countsBar(r.summary) : null),
          h("span", { class: "cell-meta muted" }, r.describe, " · ", timeAgo(r.created))));
    }),
    labsCell(d));
}

function labsCell(d) {
  return h("td", { class: "labs" }, d.labs.map((lab) => h("a", { class: "chip", href: link(["labs"], { lab }) }, lab)));
}
