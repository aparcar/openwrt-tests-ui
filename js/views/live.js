// A running job or build (model.js, "live view"): polls its index every few
// seconds, fetches only the new log chunks, and tells the page. The page
// draws a running job with the same parts as a finished one (views/tests.js
// for the tests); this file only adds what is live: the poller, a log that
// follows, and the build's steps while it builds.

import { freshNode, liveChunk, liveIndexText, testsOfJob } from "../api.js";
import {
  buildSteps, consoleRange, duration, durationHistory, liveChunkUrl, liveIndexUrl, liveStale,
  parseLiveIndex, phaseLabel, stripTerminal, testTree, toRun, typicalRunMs,
} from "../model.js";
import { h, mount, statusBadge } from "../ui.js";

const POLL_MS = 4000;
const NODE_EVERY = 4; // ask Maestro whether the node is done every 4th poll
const HISTORY_RUNS = 3; // earlier runs whose test durations give the time left
const FETCH_BATCH = 6;

// One log: its chunks so far, as bytes (test console offsets are bytes)
class LogBuffer {
  constructor(name) {
    this.name = name;
    this.chunks = [];
    this.bytes = 0;
    this.decoder = new TextDecoder();
    this.text = "";
    this.loading = Promise.resolve();
  }

  // one load at a time (a poll and a want() can overlap)
  load(indexUrl, count) {
    this.loading = this.loading.then(() => this.loadNow(indexUrl, count), () => this.loadNow(indexUrl, count));
    return this.loading;
  }

  async loadNow(indexUrl, count) {
    while (this.chunks.length < count) {
      const from = this.chunks.length + 1;
      const to = Math.min(count, from + FETCH_BATCH - 1);
      const batch = await Promise.all(Array.from({ length: to - from + 1 },
        (_, i) => liveChunk(liveChunkUrl(indexUrl, this.name, from + i))));
      for (const bytes of batch) {
        this.chunks.push(bytes);
        this.bytes += bytes.length;
        this.text += this.decoder.decode(bytes, { stream: true });
      }
    }
  }

  // bytes [start, end) as text
  slice(start, end = null) {
    const all = new Uint8Array(this.bytes);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    return new TextDecoder().decode(all.subarray(start, end ?? this.bytes));
  }
}

// The poller. node: the job (or kbuild); alive(): false once the page left
// it; onUpdate(run) after every poll; onDone(node) once the node is done.
// Logs are fetched only once something asked for them (want()).
export class LiveRun {
  constructor(node, { alive, onUpdate = () => {}, onDone = () => {}, history = [] }) {
    this.node = node;
    this.url = liveIndexUrl(node);
    this.alive = alive;
    this.onUpdate = onUpdate;
    this.onDone = onDone;
    this.index = null;
    this.logs = new Map();
    this.wanted = new Set();
    this.listeners = new Set();
    this.failures = 0;
    this.polls = 0;
    this.stopped = false;
    this.durations = new Map();
    this.typical = null;
    this.history = history;
  }

  get progress() { return this.index?.progress || {}; }
  get stale() { return liveStale(this.index); }
  // only after a few failed reads in a row: a read can meet the index while
  // the agent replaces it (cut short, or half-written JSON)
  get problem() { return this.failures >= 3 ? "The live view could not be loaded, trying again." : null; }

  want(log) {
    if (!this.wanted.has(log)) {
      this.wanted.add(log);
      if (this.index) this.poll(true);
    }
  }

  // listener(run) after every poll, until it returns false
  listen(listener) {
    this.listeners.add(listener);
  }

  log(name) { return this.logs.get(name) || null; }

  // A test's part of the console (model.consoleRange), as text
  consoleOf(testId) {
    const buffer = this.log("console");
    const range = consoleRange(this.progress.tests || [], testId);
    return buffer && range ? buffer.slice(range[0], range[1]) : "";
  }

  // The test durations of the device's last finished runs (time left)
  async loadHistory() {
    const runs = this.history.map(toRun).filter((r) => r.id !== this.node.id && r.state === "done"
      && (r.result === "pass" || r.result === "fail") && r.summary?.total);
    this.typical = typicalRunMs(runs);
    const trees = await Promise.all(runs.slice(0, HISTORY_RUNS).map((r) =>
      testsOfJob(r.id).then((t) => testTree(t.modules, t.testsByModule)).catch(() => [])));
    this.durations = durationHistory(trees);
    this.notify();
  }

  start() {
    this.loadHistory();
    setTimeout(() => this.poll(), 0);
  }

  notify() {
    this.onUpdate(this);
    for (const listener of this.listeners) {
      if (listener(this) === false) this.listeners.delete(listener);
    }
  }

  async poll(once = false) {
    if (this.stopped) return;
    if (!this.alive()) {
      this.stopped = true;
      return;
    }
    if (!once) this.polls++;
    try {
      const text = await liveIndexText(this.url);
      const index = text == null ? null : parseLiveIndex(text);
      if (index) {
        this.index = index;
        for (const name of this.wanted) {
          if (!index.logs[name]) continue;
          if (!this.logs.has(name)) this.logs.set(name, new LogBuffer(name));
          await this.logs.get(name).load(this.url, index.logs[name].chunks || 0);
        }
        this.failures = 0;
      } else if (text != null) {
        this.failures++;
      }
    } catch {
      this.failures++;
    }
    this.notify();
    if (once) return;
    if (this.index?.done || this.polls % NODE_EVERY === 0) {
      try {
        const now = await freshNode(this.node.id);
        if (now.state === "done") {
          this.stopped = true;
          this.onDone(now);
          return;
        }
      } catch { /* next time */ }
    }
    setTimeout(() => this.poll(), POLL_MS);
  }
}

// A log that grows: text() gives what to show; it follows the end while
// the reader is at the bottom (scrolling up stops that, scrolling back down
// resumes it)
export function followingLog(run, text, { full = false, log = "console", empty = "Nothing yet." } = {}) {
  run.want(log);
  const pre = h("pre", { class: full ? "log full" : "log" });
  let shown = null;
  const atBottom = () => (full
    ? window.innerHeight + window.scrollY >= document.body.scrollHeight - 40
    : pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40);
  const render = () => {
    // a closed test: catch up when it is opened again (next poll)
    if (!full && pre.isConnected && !pre.closest("details")?.open) return true;
    const text_ = stripTerminal(text());
    // nothing yet: the placeholder (it can change, e.g. once the test is done)
    const placeholder = text_ ? null : (typeof empty === "function" ? empty() : empty);
    const next = text_ || `\0${placeholder}`;
    if (next === shown) return pre.isConnected;
    const follow = atBottom();
    if (text_ && shown && !shown.startsWith("\0") && next.startsWith(shown)) pre.append(next.slice(shown.length));
    else mount(pre, text_ || h("span", { class: "muted" }, placeholder));
    shown = next;
    if (follow) {
      if (full) window.scrollTo(0, document.body.scrollHeight);
      else pre.scrollTop = pre.scrollHeight;
    }
    return pre.isConnected;
  };
  render();
  run.listen(() => render());
  return pre;
}

// What is happening now, for the page head: "Testing · about 6 min left"
export function liveHeadline(run, remaining) {
  const p = run.progress;
  if (!run.index) return run.problem || "Waiting for the lab's first update…";
  const parts = [phaseLabel(p.phase)];
  if (remaining != null && !run.index.done) parts.push(`about ${duration(remaining) || "a moment"} left`);
  else if (p.total == null && run.typical) parts.push(`runs usually take ${duration(run.typical)}`);
  return parts.join(" · ");
}

// A build that is still building: its steps and its log
export function buildSection(build, { alive, onDone }) {
  const steps = h("ul", { class: "tests steps" });
  const head = h("p", { class: "muted" }, "Waiting for the build agent's first update…");
  const logHost = h("div", { class: "log-host" });
  const section = h("section", {},
    h("div", { class: "section-head" }, h("h2", {}, "Build")),
    h("div", { class: "module c-running build-steps" }, head, steps, logHost));
  const run = new LiveRun(build, {
    alive,
    onDone,
    onUpdate: (r) => {
      if (!r.index) return;
      const end = r.index.done ? Date.parse(r.index.updated) : Date.now();
      const list = buildSteps(r.progress, end);
      mount(head, r.stale ? h("span", { class: "t-fail" }, "No update from the build agent for a while.")
        : `${phaseLabel(r.progress.phase)} · ${list.length} step${list.length === 1 ? "" : "s"} so far`);
      mount(steps, list.map((s) => h("li", { class: "step" },
        statusBadge(s.current && !r.index.done ? "running" : "pass", { compact: true }),
        h("span", { class: "mono test-name" }, s.name),
        h("span", { class: "grow" }),
        h("span", { class: "muted test-time" }, duration(s.ms)))));
    },
  });
  mount(logHost, followingLog(run, () => run.log("build")?.text || "", { log: "build" }));
  run.start();
  return section;
}
