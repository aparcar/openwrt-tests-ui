// Live view of a running job or build (model.js, "live view"): what it is
// doing, its tests (builds: steps) as they finish, the time left, and its
// logs as they grow. Polls the index every few seconds and fetches only the
// new chunks; stops once the node is done (then the page shows the results)
// or the section left the page.

import { freshNode, liveChunk, liveIndexText, testsOfJob } from "../api.js";
import {
  buildSteps, consoleRange, duration, durationHistory, liveChunkUrl, liveIndexUrl, liveStale, liveTests,
  parseLiveIndex, phaseLabel, remainingMs, stripTerminal, testTree, toRun, typicalRunMs,
} from "../model.js";
import { h, mount, statusBadge, timeAgo } from "../ui.js";

const POLL_MS = 4000;
const NODE_EVERY = 4; // ask Maestro whether the node is done every 4th poll
const HISTORY_RUNS = 3; // earlier runs whose test durations give the time left
const FETCH_BATCH = 6;

const LOG_LABELS = { console: "Console", pytest: "pytest output", build: "Build log" };

// One log: its chunks so far, as bytes (test console offsets are bytes)
class LogBuffer {
  constructor(name) {
    this.name = name;
    this.chunks = [];
    this.decoder = new TextDecoder();
    this.text = "";
  }

  // Fetch chunks up to `count`; returns the new text
  async load(indexUrl, count) {
    let added = "";
    while (this.chunks.length < count) {
      const from = this.chunks.length + 1;
      const to = Math.min(count, from + FETCH_BATCH - 1);
      const batch = await Promise.all(Array.from({ length: to - from + 1 },
        (_, i) => liveChunk(liveChunkUrl(indexUrl, this.name, from + i))));
      for (const bytes of batch) {
        this.chunks.push(bytes);
        added += this.decoder.decode(bytes, { stream: true });
      }
    }
    this.text += added;
    return added;
  }

  // bytes [start, end) as text
  slice(start, end) {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    return new TextDecoder().decode(all.subarray(start, end ?? total));
  }
}

// node: the running job (kind "test") or kbuild (kind "build"); history:
// earlier runs of the same device (job nodes), for the time left; onDone:
// called once the node is done
export function liveSection(node, { kind = "test", history = [], onDone = () => {} } = {}) {
  const url = liveIndexUrl(node);
  const head = h("div", { class: "live-head" });
  const list = h("ol", { class: "live-list" });
  const tabs = h("div", { class: "live-tabs", role: "tablist" });
  const filterNote = h("div", { class: "live-filter" });
  const follow = h("input", { type: "checkbox", checked: true });
  const pre = h("pre", { class: "log live-log", tabindex: "0" });
  const section = h("section", { class: "live" },
    h("div", { class: "section-head" },
      h("h2", {}, kind === "build" ? "Build in progress" : "Live", " ", h("span", { class: "live-dot", "aria-hidden": "true" }))),
    head,
    h("div", { class: "live-cols" },
      list,
      h("div", { class: "live-logs" },
        h("div", { class: "log-tools" }, tabs, h("span", { class: "grow" }),
          h("label", {}, follow, " Follow")),
        filterNote,
        pre)));

  const logs = new Map();
  let index = null;
  let active = null; // log shown
  let filter = null; // { id, name }: only this test's part of the console
  let durations = new Map();
  let typical = null;
  let polls = 0;
  let stopped = false;
  let wasConnected = false;
  let problem = null;

  const nearBottom = () => pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  const scrollDown = () => { if (follow.checked) pre.scrollTop = pre.scrollHeight; };

  function renderLog() {
    const buffer = logs.get(active);
    if (!buffer) {
      mount(pre, h("span", { class: "muted" }, "Nothing yet."));
      return;
    }
    let text = buffer.text;
    mount(filterNote);
    if (filter && active === "console") {
      const range = consoleRange(index?.progress?.tests || [], filter.id);
      if (range) text = buffer.slice(range[0], range[1]);
      mount(filterNote, "Console of ", h("span", { class: "mono" }, filter.name), " · ",
        h("button", { type: "button", class: "linklike", onclick: () => { filter = null; renderLog(); } }, "show all"));
    }
    mount(pre, stripTerminal(text) || h("span", { class: "muted" }, "Nothing yet."));
    scrollDown();
  }

  function renderTabs() {
    const names = Object.keys(index?.logs || {});
    mount(tabs, names.map((name) => h("button", {
      type: "button", role: "tab", class: "tab", "aria-selected": String(name === active),
      onclick: () => { active = name; filter = null; renderTabs(); refreshLog().then(renderLog); },
    }, LOG_LABELS[name] || name)));
  }

  function renderHead() {
    if (!index) {
      mount(head, h("p", { class: "muted" }, problem || "Waiting for the first update…"));
      return;
    }
    const p = index.progress || {};
    const parts = [h("strong", {}, phaseLabel(p.phase))];
    if (kind === "test") {
      const tests = liveTests(p, durations);
      const failed = (p.counts?.fail || 0) + (p.counts?.incomplete || 0);
      if (p.total != null) parts.push(` · ${p.done}/${p.total} tests`);
      if (failed) parts.push(h("span", { class: "t-fail" }, ` · ${failed} failed`));
      const left = p.total != null ? remainingMs(tests, durations) : null;
      if (left != null && !index.done) parts.push(` · about ${duration(left) || "a moment"} left`);
      else if (p.total == null && typical) parts.push(h("span", { class: "muted" }, ` · runs usually take ${duration(typical)}`));
    }
    if (p.started) parts.push(h("span", { class: "muted" }, " · started ", timeAgo(p.started)));
    mount(head,
      h("p", {}, parts),
      liveStale(index) ? h("div", { class: "notice n-infra", role: "status" },
        h("strong", {}, "No update "), timeAgo(index.updated),
        ": the lab may have stopped. The job goes back to the queue or times out.") : null,
      problem ? h("p", { class: "muted" }, problem) : null);
  }

  function renderList() {
    const p = index?.progress || {};
    if (kind === "build") {
      const end = index?.done ? Date.parse(index.updated) : Date.now();
      mount(list, buildSteps(p, end).map((s) => h("li", { class: `live-item ${s.current && !index.done ? "is-running" : ""}` },
        s.current && !index.done ? statusBadge("running", { compact: true }) : statusBadge("pass", { compact: true }),
        h("span", { class: "live-name" }, s.name),
        h("span", { class: "muted" }, duration(s.ms)))));
      return;
    }
    const tests = liveTests(p, durations);
    if (!tests.length) {
      mount(list, h("li", { class: "muted" }, p.phase === "fetching" ? "Downloading the firmware…" : "Waiting for pytest to list its tests…"));
      return;
    }
    mount(list, tests.map((t) => {
      const icon = t.state === "done" ? statusBadge(t.result || "incomplete", { compact: true })
        : t.state === "running" ? statusBadge("running", { compact: true })
          : h("span", { class: "badge s-pending", title: "Not run yet" }, h("span", { class: "badge-icon" }, "○"));
      const time = t.state === "done" ? duration(t.ms)
        : t.state === "running" ? `${duration(t.elapsedMs) || "0s"}${t.expectedMs ? ` of ~${duration(t.expectedMs)}` : ""}`
          : t.expectedMs ? `~${duration(t.expectedMs)}` : "";
      const name = h("span", { class: "live-name" }, h("span", { class: "muted" }, `${t.module} › `), h("span", { class: "mono" }, t.name));
      return h("li", { class: `live-item s-${t.state}${filter?.id === t.id ? " is-selected" : ""}` },
        icon,
        t.console != null
          ? h("button", { type: "button", class: "linklike", title: "Show this test's part of the console",
            onclick: () => { active = "console"; filter = { id: t.id, name: t.name }; renderTabs(); refreshLog().then(renderLog); } }, name)
          : name,
        h("span", { class: "muted" }, time));
    }));
  }

  // Fetch the active log's new chunks; append them unless a filter is shown
  async function refreshLog() {
    if (!index || !active || !index.logs[active]) return;
    if (!logs.has(active)) logs.set(active, new LogBuffer(active));
    const buffer = logs.get(active);
    const wasAtBottom = nearBottom();
    const added = await buffer.load(url, index.logs[active].chunks || 0);
    if (!added) return;
    if (filter && active === "console") {
      renderLog();
    } else if (pre.firstChild?.classList?.contains?.("muted")) {
      renderLog();
    } else {
      pre.append(stripTerminal(added));
      if (wasAtBottom) scrollDown();
    }
  }

  async function loadHistory() {
    const runs = history.map(toRun).filter((r) => r.id !== node.id && r.state === "done"
      && (r.result === "pass" || r.result === "fail") && r.summary?.total);
    typical = typicalRunMs(runs);
    const trees = await Promise.all(runs.slice(0, HISTORY_RUNS).map((r) =>
      testsOfJob(r.id).then((t) => testTree(t.modules, t.testsByModule)).catch(() => [])));
    durations = durationHistory(trees);
    renderHead();
    renderList();
  }

  async function poll() {
    if (stopped) return;
    if (section.isConnected) wasConnected = true;
    else if (wasConnected || polls > 3) { stopped = true; return; }
    polls++;
    try {
      const text = await liveIndexText(url);
      const parsed = text == null ? null : parseLiveIndex(text);
      if (parsed) {
        const first = !index;
        index = parsed;
        if (first || !active || !index.logs[active]) {
          active ??= "console" in index.logs ? "console" : Object.keys(index.logs)[0] || null;
          renderTabs();
        }
        await refreshLog();
        if (first) renderLog();
      }
      problem = null;
    } catch (err) {
      problem = `Could not load the live view (${err.message}), trying again.`;
    }
    renderHead();
    renderList();
    if (index?.done || polls % NODE_EVERY === 0) {
      try {
        const now = await freshNode(node.id);
        if (now.state === "done") {
          stopped = true;
          onDone(now);
          return;
        }
      } catch { /* next time */ }
    }
    setTimeout(poll, POLL_MS);
  }

  renderHead();
  renderList();
  if (kind === "test") loadHistory();
  setTimeout(poll, 0);
  return section;
}
