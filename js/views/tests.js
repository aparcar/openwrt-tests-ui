// The Tests section of a run: modules, their tests, each test opening to its
// reason, recorded values and log. The same list for a finished run and a
// running one (model.liveTree): update() changes it in place, so what is
// open stays open and nothing moves while tests finish. Order is the one the
// tests ran in, in both; failures are listed above the modules instead of
// sorted first.
//
// Live only: the running test opens by itself (and closes again once done,
// unless someone opened or closed it by hand), and its module with it.

import { duration, reasonParts, summarize } from "../model.js";
import { h, mount, ranCount, setQuery, statusBadge } from "../ui.js";

// logFor(test) -> Element or Promise<Element>: the test's log, made when it
// is first opened. selected: a test id from the link (?test=<id>).
export function testList({ logFor, selected = null }) {
  const failures = h("div", { class: "failures" });
  const list = h("div", { class: "modules" });
  const root = h("div", {}, failures, list);
  const modules = new Map(); // module name -> { el, ul, summary, tests: Map(id -> item) }
  let first = true;

  function module(m, live) {
    let entry = modules.get(m.name);
    if (!entry) {
      const summary = h("summary", {});
      const about = h("div", {});
      const ul = h("ul", { class: "tests" });
      const el = h("details", {}, summary, about, ul);
      entry = { el, ul, summary, about, aboutText: null, tests: new Map(), touched: false, auto: false, expected: null };
      el.addEventListener("toggle", () => {
        if (entry.expected !== el.open) entry.touched = true;
        entry.expected = null;
      });
      modules.set(m.name, entry);
      // failed ones, the selected test's, and a run's only module unless it passed
      const open = m.result === "fail" || m.result === "incomplete" || m.tests.some((t) => t.id === selected)
        || (first && !live && treeSize === 1 && m.result !== "pass");
      setOpen(entry, open);
    }
    const s = summarize([m]);
    entry.el.className = `module c-${m.result || "incomplete"}`;
    mount(entry.summary,
      statusBadge(m.result || "incomplete", { compact: true }),
      h("span", { class: "module-name", title: firstParagraph(m.description) }, m.name),
      // passed of the tests that ran: skipped ones are not failures
      h("span", { class: "muted module-counts" }, ranCount(s) ? `${s.passed}/${ranCount(s)} passed` : s.pending ? "not run yet" : "none ran",
        s.failed ? h("span", { class: "t-fail" }, ` · ${s.failed} failed`) : null,
        s.skipped - s.xfailed ? ` · ${s.skipped - s.xfailed} skipped` : null,
        s.xfailed ? ` · ${s.xfailed} expected to fail` : null,
        s.pending ? ` · ${s.pending} to go` : null));
    // what the module covers, above its tests
    if (m.description !== entry.aboutText) {
      entry.aboutText = m.description;
      mount(entry.about, m.description ? testDescription(m.description, "module-description") : null);
    }
    // live: open the module of the running test; close it again once it is
    // through, unless it failed or someone opened or closed it
    if (live && !entry.touched) {
      if (m.result === "running" && !entry.el.open) {
        setOpen(entry, true);
        entry.auto = true;
      } else if (entry.auto && m.result !== "running" && m.result !== "fail" && m.result !== "incomplete") {
        setOpen(entry, false);
        entry.auto = false;
      }
    }
    return entry;
  }

  // the state we set ourselves: its toggle event is not someone's click
  function setOpen(entry, open) {
    if (entry.el.open === open) return;
    entry.expected = open;
    entry.el.open = open;
  }

  function test(entry, t, live) {
    let item = entry.tests.get(t.id);
    if (!item) {
      item = testItem(t, logFor, t.id === selected);
      entry.tests.set(t.id, item);
    }
    item.update(t, live);
    return item;
  }

  let treeSize = 0;
  function update(tree, { live = false } = {}) {
    treeSize = tree.length;
    const seen = new Set();
    // in order: appending an element that is already there moves it, which
    // keeps it (open, with its log) as it is
    for (const m of tree) {
      const entry = module(m, live);
      seen.add(m.name);
      const ids = new Set();
      for (const t of m.tests) {
        entry.ul.append(test(entry, t, live).li);
        ids.add(t.id);
      }
      for (const [id, item] of entry.tests) {
        if (!ids.has(id)) {
          item.li.remove();
          entry.tests.delete(id);
        }
      }
      list.append(entry.el);
    }
    for (const [name, entry] of modules) {
      if (!seen.has(name)) {
        entry.el.remove();
        modules.delete(name);
      }
    }
    // what failed, at a glance (the list itself keeps its order)
    const failed = tree.flatMap((m) => m.tests.filter((t) => t.result === "fail" || t.result === "incomplete")
      .map((t) => ({ m, t })));
    mount(failures, failed.length ? [h("strong", {}, `${failed.length} failed: `),
      failed.map(({ m, t }, i) => [i ? ", " : "", h("button", {
        type: "button", class: "linkish inline mono",
        onclick: () => {
          const entry = modules.get(m.name);
          setOpen(entry, true);
          entry.touched = true;
          const item = entry.tests.get(t.id);
          item.open();
          item.li.scrollIntoView({ block: "start" });
        },
      }, `${m.name} › ${t.name}`)])] : null);
    first = false;
  }

  return { el: root, update };
}

// Why a test was skipped or is expected to fail, issue references linked
function testReason(t) {
  const known = t.result === "xfail";
  return h("p", { class: `test-reason${known ? " r-xfail" : ""}` },
    h("strong", {}, known ? "Expected to fail: " : "Skipped: "),
    reasonParts(t.errorMsg).map((p) => (p.url ? h("a", { href: p.url }, p.text) : p.text)),
    known ? h("span", { class: "muted" }, " (a known problem, not counted as a failure)") : null);
}

// What a test or module checks and why (its docstring), paragraphs as written
function testDescription(text, cls = "test-description") {
  return h("div", { class: cls },
    text.split(/\n\s*\n/).map((p) => h("p", {}, p.replace(/\s*\n\s*/g, " "))));
}

// A docstring's first paragraph, for a tooltip; null without one
function firstParagraph(text) {
  return text?.split(/\n\s*\n/)[0] || null;
}

// What a test recorded (record_property), shown above its log
function propertiesTable(properties) {
  return h("table", { class: "test-properties" },
    h("tbody", {}, properties.map(([name, value]) =>
      h("tr", {}, h("th", { scope: "row", class: "mono" }, name), h("td", { class: "mono" }, value)))));
}

// The time column: the duration once done; while running the time so far
// and what it usually takes; still to come: what it usually takes
function timeText(t) {
  if (t.result === "running") {
    return `${duration(t.durationMs) || "0s"}${t.expectedMs ? ` / ~${duration(t.expectedMs)}` : ""}`;
  }
  if (t.result === "pending") return t.expectedMs ? `~${duration(t.expectedMs)}` : "";
  return t.durationMs != null ? duration(t.durationMs) : "";
}

function testItem(t, logFor, selected) {
  const summary = h("summary", {});
  const extra = h("div", {});
  const logHost = h("div", { class: "log-host" });
  const details = h("details", {}, summary, extra, logHost);
  const li = h("li", {}, details);
  let loaded = false;
  let touched = false;
  let auto = false;
  let current = t;
  let extraKey = null;
  // the state we set ourselves: its toggle event is not someone's click
  let expected = null;

  const setOpen = (open) => {
    if (details.open === open) return;
    expected = open;
    details.open = open;
  };

  async function load() {
    if (loaded) return;
    loaded = true;
    mount(logHost, h("p", { class: "muted" }, "Loading log…"));
    try {
      mount(logHost, await logFor(current));
    } catch (err) {
      loaded = false;
      mount(logHost, h("p", { class: "error" }, String(err.message || err)));
    }
  }

  details.addEventListener("toggle", () => {
    const ours = expected === details.open;
    expected = null;
    if (!ours) {
      touched = true;
      // the address bar links to the test someone opened
      if (details.open) setQuery({ test: current.id });
    }
    if (details.open) load();
  });

  function update(next, live) {
    current = next;
    const informational = next.result === "skip" || next.result === "xfail";
    details.className = `test c-${next.result || "incomplete"}`;
    mount(summary,
      statusBadge(next.result || "incomplete", { compact: true }),
      // hovering the name tells what the test is about (first paragraph)
      h("span", { class: "mono test-name", title: firstParagraph(next.description) }, next.name),
      // failure reason in red, skip and xfail reason muted
      next.errorMsg ? h("span", { class: `test-error${informational ? "" : " t-fail"}`, title: next.errorMsg },
        next.errorMsg.split("\n")[0]) : null,
      h("span", { class: "grow" }),
      next.properties.length ? h("span", { class: "chip plain", title: "Values the test recorded" },
        `${next.properties.length} value${next.properties.length === 1 ? "" : "s"}`) : null,
      h("span", { class: "muted test-time" }, timeText(next)));
    // description, reason and recorded values: only rebuilt when they changed
    const key = JSON.stringify([next.result, next.errorMsg, next.properties, next.description]);
    if (key !== extraKey) {
      extraKey = key;
      mount(extra,
        next.description ? testDescription(next.description) : null,
        informational && next.errorMsg ? testReason(next) : null,
        next.properties.length ? propertiesTable(next.properties) : null);
    }
    // live: the running test opens (its console follows), and closes once
    // done, unless someone opened or closed it
    if (live && !touched) {
      if (next.result === "running" && !details.open) {
        setOpen(true);
        auto = true;
      } else if (auto && next.result !== "running") {
        setOpen(false);
        auto = false;
      }
    }
  }

  update(t, false);
  if (selected) {
    details.open = true; // loads the log via the toggle event
    requestAnimationFrame(() => li.scrollIntoView({ block: "start" }));
  }
  return { li, update, open: () => { touched = true; details.open = true; } };
}
