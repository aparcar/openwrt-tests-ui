// Small DOM helpers. All text goes through textContent / attributes, never
// innerHTML, so data from the API can't inject markup.

import { isOfficial, STATUS, relativeTime } from "./model.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

export function statusBadge(st, { compact = false, extra = null } = {}) {
  const s = STATUS[st] || STATUS.none;
  return h("span", { class: `badge s-${st}`, title: s.label },
    h("span", { class: "badge-icon", "aria-hidden": "true" }, s.icon),
    compact ? h("span", { class: "sr-only" }, s.label) : h("span", {}, s.label),
    extra);
}

export function timeAgo(iso) {
  if (!iso) return h("span", { class: "muted" }, "—");
  const exact = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  return h("time", { datetime: exact, title: new Date(exact).toLocaleString() }, relativeTime(iso));
}

// passed/failed/skipped as a segmented bar plus text
export function countsBar(summary) {
  if (!summary || !summary.total) return h("span", { class: "muted" }, "—");
  const pct = (n) => `${(100 * n) / summary.total}%`;
  const failed = (summary.failed || 0) + (summary.errors || 0);
  return h("span", { class: "counts", title: `${summary.passed} passed, ${failed} failed, ${summary.skipped} skipped` },
    h("span", { class: "bar", "aria-hidden": "true" },
      h("span", { class: "seg s-pass", style: `width:${pct(summary.passed)}` }),
      h("span", { class: "seg s-fail", style: `width:${pct(failed)}` }),
      h("span", { class: "seg s-skip", style: `width:${pct(summary.skipped)}` })),
    h("span", { class: "counts-text" }, `${summary.passed}/${summary.total}`,
      failed ? h("span", { class: "t-fail" }, ` · ${failed} failed`) : null));
}

export function skeletonRows(n, cols) {
  return Array.from({ length: n }, () =>
    h("tr", { class: "skeleton" }, Array.from({ length: cols }, () => h("td", {}, h("span", { class: "sk" })))));
}

export function emptyState(title, text, action = null) {
  return h("div", { class: "empty" }, h("h3", {}, title), h("p", {}, text), action);
}

export function errorBox(err) {
  return h("div", { class: "error", role: "alert" },
    h("strong", {}, "Could not load data. "), String(err.message || err));
}

// Hash router helpers: #/path?query
export function route() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  return { parts: (path || "/").split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) };
}

export function link(parts, query) {
  const qs = query && [...new URLSearchParams(query)].length ? `?${new URLSearchParams(query)}` : "";
  return `#/${parts.map(encodeURIComponent).join("/")}${qs}`;
}

export function setQuery(query) {
  const { parts } = route();
  history.replaceState(null, "", link(parts, query));
}

// "manual · aparcar" for runs not created by the nightly schedule (official:
// config.official); nothing for official runs
export function manualBadge(run, official) {
  if (isOfficial(run, official)) return null;
  const title = [run.trigger?.title, `triggered by ${run.owner || "someone"}`].filter(Boolean).join(" · ");
  return h("span", { class: "chip manual", title }, "manual · ", run.owner || "?");
}

// Tables that turn into cards on narrow screens (CSS: table.stack): every
// cell gets its column's heading as data-label, shown above its content.
// A heading can set its own label (data-label), e.g. "main Snapshot".
export function stackTable(table) {
  table.classList.add("stack");
  const labels = [...table.querySelectorAll("thead th")].map((th) => th.dataset.label || th.textContent.trim());
  for (const row of table.querySelectorAll("tbody tr")) {
    [...row.children].forEach((cell, i) => {
      if (labels[i] && !cell.dataset.label) cell.dataset.label = labels[i];
    });
  }
  return table;
}
