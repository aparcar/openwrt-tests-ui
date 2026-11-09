// One run (job node): what was tested where, the result per test with its
// own log, and links to the whole run's files.

import { bootOfJob, buildOfJob, fetchText, jobsForPlatformBranch, node, proxiedArtifact, publicLinks, testsOfJob } from "../api.js";
import { duration, isOfficial, labOf, logLines, reasonParts, releasesOf, safeUrl, status, summarize, testTree, toRun } from "../model.js";
import { countsBar, emptyState, errorBox, h, link, mount, route, setQuery, statusBadge, timeAgo } from "../ui.js";
import { scheduleBox } from "./schedule.js";

export async function runView(root, state, id) {
  mount(root, h("p", { class: "muted" }, "Loading run…"));
  const job = await node(id);
  const run = toRun(job);
  const device = { name: run.deviceName || run.platform };
  const lab = labOf(run, new Set([state.config.pool, run.pool].filter(Boolean)));
  const [build, boot, tests, history] = await Promise.all([
    buildOfJob(job).catch(() => null),
    bootOfJob(job).catch(() => null),
    testsOfJob(id).catch((err) => ({ error: err })),
    jobsForPlatformBranch(run.platform, run.branch, 20).catch(() => []),
  ]);
  const ow = build?.data?.openwrt || {};
  const st = status(run);
  const links = publicLinks(id);
  const tree = tests.error ? [] : testTree(tests.modules, tests.testsByModule);
  const counts = tree.length ? summarize(tree) : run.summary;

  // Neighbours in the same lane (same branch, release or snapshot)
  const lane = history.map(toRun).filter((r) => r.lane === run.lane && (!r.discarded || r.id === id));
  const at = lane.findIndex((r) => r.id === id);
  const older = at >= 0 ? lane[at + 1] : null;
  const newer = at > 0 ? lane[at - 1] : null;

  mount(root,
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
      h("a", { href: link([]) }, "Devices"), " / ",
      h("a", { href: link(["device", run.platform]) }, device.name), " / ",
      h("span", {}, run.describe)),
    h("header", { class: `page-head run-head c-${st}` },
      h("div", {},
        h("h1", {}, device.name, " ", h("span", { class: "muted" }, "·"), " ", run.describe),
        h("p", { class: "lede" },
          run.isRelease ? "Release" : "Snapshot", " of ", h("strong", {}, run.branch),
          ow.target ? [" · ", h("span", { class: "mono" }, `${ow.target}/${ow.profile || ""}`)] : null)),
      h("div", { class: "head-status" }, statusBadge(st), counts ? countsBar(counts) : null)),
    run.discarded ? h("div", { class: "notice n-discarded", role: "status" },
      h("strong", {}, "Discarded"), run.discarded.reason ? [": ", run.discarded.reason] : null,
      h("span", { class: "muted" }, ` (by ${run.discarded.by || "someone"}`,
        run.discarded.at ? [", ", timeAgo(run.discarded.at)] : null,
        "; not shown in the overview, device and lab pages)")) : null,
    isOfficial(run, state.config.official) ? null : h("div", { class: "notice n-manual" },
      h("strong", {}, `Manual run by ${run.owner || "someone"}`),
      run.trigger.title ? [": ", run.trigger.title] : null,
      safeUrl(run.trigger.url) ? [" · ", h("a", { href: safeUrl(run.trigger.url) }, "link ↗")] : null,
      h("span", { class: "muted" }, " (not part of the official results)")),
    run.errorMsg ? h("div", { class: `notice ${run.errorCode ? "n-infra" : "n-fail"}`, role: "status" },
      h("strong", {}, run.errorCode === "Infrastructure" ? "Lab problem: " : "Problem: "), run.errorMsg,
      run.errorCode === "Infrastructure" ? h("span", { class: "muted" }, " (not a firmware regression)") : null) : null,
    h("section", { class: "facts" },
      fact("Lab", lab ? h("a", { href: link(["labs"], { lab }) }, lab) : h("span", { class: "muted" }, "waiting for a lab")),
      fact("Device", run.device ? h("span", { class: "mono" }, run.device) : "—"),
      fact("Firmware", ow.image ? h("span", { class: "mono wrap" }, ow.image) : "—"),
      fact("Commit", run.commit
        ? (links.commit(run.commit) ? h("a", { href: links.commit(run.commit), class: "mono" }, run.commit.slice(0, 12)) : run.commit.slice(0, 12))
        : "—"),
      fact("Triggered by", isOfficial(run, state.config.official)
        ? h("span", {}, "nightly schedule ", h("span", { class: "muted" }, `(${run.owner})`))
        : h("a", { href: link(["manual"], { by: run.owner }) }, run.owner || "—")),
      fact("Started", timeAgo(run.created)),
      fact("Duration", run.durationMs != null ? duration(run.durationMs) : "—"),
      fact("Boot", boot ? statusBadge(boot.result || "incomplete") : h("span", { class: "muted" }, "—"))),
    h("section", { class: "files" },
      h("h2", {}, "Files"),
      h("div", { class: "file-links" },
        Object.entries(TEXT_FILES).map(([key, label]) => job.artifacts?.[key]
          ? h("a", { class: "file", href: link(["run", id, "file", key]) }, label) : null),
        fileLink("Firmware ↓", build?.artifacts?.firmware, ow.sha256 ? `sha256 ${ow.sha256}` : null),
        links.viewer ? h("a", { class: "file", href: links.viewer }, "Raw node in Maestro ↗") : null)),
    h("section", {},
      h("div", { class: "section-head" },
        h("h2", {}, "Tests"),
        h("div", { class: "pager" },
          older ? h("a", { href: link(["run", older.id]), title: older.describe }, "← Previous build") : null,
          newer ? h("a", { href: link(["run", newer.id]), title: newer.describe }, "Next build →") : null)),
      tests.error ? errorBox(tests.error)
        : tree.length ? testList(tree, st, route().query.get("test"))
          : emptyState(st === "queued" || st === "running" ? "No results yet" : "No test results",
            st === "queued" ? "Waiting for a lab with this device to pick the run up."
              : st === "running" ? `Running on ${lab}.`
                : "The run ended before any test reported. See the console log and pytest output above.")),
    runAgain(run, lab, history.map(toRun), state),
  );
}

// The same build (official ones only) on the same lab
function runAgain(run, lab, history, state) {
  const pools = new Set([state.config.pool, ...history.map((r) => r.pool)].filter(Boolean));
  const labs = [...new Set([lab, ...history.map((r) => labOf(r, pools))].filter(Boolean))].sort();
  const releases = releasesOf([run, ...history]);
  return scheduleBox({
    title: "Run again",
    device: run.platform,
    releases,
    labs,
    initial: { release: releases.includes(run.release) ? run.release : releases[0], lab: lab || "" },
  });
}

function fact(label, value) {
  return h("div", { class: "fact" }, h("span", { class: "fact-label" }, label), h("span", { class: "fact-value" }, value));
}

// The run's text files, shown in the page (#/run/<id>/file/<key>): storage
// sends everything as a download (Content-Disposition: attachment)
const TEXT_FILES = {
  test_log: "Console log",
  pytest_log: "pytest output",
  junit: "JUnit XML",
  job_definition: "Job definition",
};

export async function fileView(root, state, id, key) {
  mount(root, h("p", { class: "muted" }, "Loading…"));
  const job = await node(id);
  const run = toRun(job);
  const label = TEXT_FILES[key] || key;
  const url = job.artifacts?.[key];
  const crumbs = h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
    h("a", { href: link([]) }, "Devices"), " / ",
    h("a", { href: link(["device", run.platform]) }, run.deviceName || run.platform), " / ",
    h("a", { href: link(["run", id]) }, run.describe), " / ",
    h("span", {}, label));
  if (!url) {
    mount(root, crumbs, emptyState(`No ${label.toLowerCase()}`, "This run has no such file."));
    return;
  }
  let text = await fetchText(url);
  // job definitions are compact JSON
  if (key === "job_definition") {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as is */ }
  }
  mount(root, crumbs,
    h("header", { class: "page-head" }, h("div", {},
      h("h1", {}, label),
      h("p", { class: "lede" }, `${run.deviceName || run.platform} · ${run.describe} · `,
        `${text.split("\n").length} lines`))),
    logView(text, url, { full: true }));
}

function fileLink(label, url, title = null) {
  if (!url) return null;
  return h("a", { class: "file", href: proxiedArtifact(url), title }, label);
}

// Failed tests first and open; each test expands to its own log
// selected: a test id from the link (?test=<id>), opened and scrolled to
function testList(tree, st, selected) {
  const failedFirst = (a, b) => rank(b.result) - rank(a.result);
  return h("div", { class: "modules" },
    [...tree].sort((a, b) => failedFirst(a, b) || a.name.localeCompare(b.name)).map((m) => {
      const s = summarize([m]);
      const open = m.result === "fail" || m.result === "incomplete" || (tree.length === 1 && st !== "pass")
        || m.tests.some((t) => t.id === selected);
      return h("details", { class: `module c-${m.result || "incomplete"}`, open },
        h("summary", {},
          statusBadge(m.result || "incomplete", { compact: true }),
          h("span", { class: "module-name" }, m.name),
          h("span", { class: "muted module-counts" }, `${s.passed}/${s.total} passed`,
            s.failed ? h("span", { class: "t-fail" }, ` · ${s.failed} failed`) : null,
            s.skipped - s.xfailed ? ` · ${s.skipped - s.xfailed} skipped` : null,
            s.xfailed ? ` · ${s.xfailed} expected to fail` : null)),
        h("ul", { class: "tests" }, [...m.tests].sort((a, b) => failedFirst(a, b) || a.name.localeCompare(b.name)).map((t) => testItem(t, t.id === selected))));
    }));
}

const rank = (result) => ({ fail: 3, incomplete: 2, error: 2, xfail: 1.5, pass: 1, skip: 0 }[result] ?? 2);

// Why a test was skipped or is expected to fail, issue references linked
function testReason(t) {
  const known = t.result === "xfail";
  return h("p", { class: `test-reason${known ? " r-xfail" : ""}` },
    h("strong", {}, known ? "Expected to fail: " : "Skipped: "),
    reasonParts(t.errorMsg).map((p) => (p.url ? h("a", { href: p.url }, p.text) : p.text)),
    known ? h("span", { class: "muted" }, " (a known problem, not counted as a failure)") : null);
}

function testItem(t, selected) {
  const logHost = h("div", { class: "log-host" });
  let loaded = false;
  const informational = t.result === "skip" || t.result === "xfail";
  const item = h("details", { class: `test c-${t.result || "incomplete"}` },
    h("summary", {},
      statusBadge(t.result || "incomplete", { compact: true }),
      h("span", { class: "mono test-name" }, t.name),
      // failure reason in red, skip and xfail reason muted
      t.errorMsg ? h("span", { class: `test-error${informational ? "" : " t-fail"}`, title: t.errorMsg },
        t.errorMsg.split("\n")[0]) : null,
      h("span", { class: "grow" }),
      t.properties.length ? h("span", { class: "chip plain", title: "Values the test recorded" },
        `${t.properties.length} value${t.properties.length === 1 ? "" : "s"}`) : null,
      h("span", { class: "muted" }, t.durationMs != null ? duration(t.durationMs) : "")));
  if (informational && t.errorMsg) item.append(testReason(t));
  if (t.properties.length) item.append(propertiesTable(t.properties));
  item.append(logHost);
  item.addEventListener("toggle", async () => {
    // the address bar links to the open test
    if (item.open) setQuery({ test: t.id });
    if (!item.open || loaded) return;
    loaded = true;
    mount(logHost, h("p", { class: "muted" }, "Loading log…"));
    try {
      if (!t.logUrl) {
        mount(logHost, h("p", { class: "muted" },
          "No log of its own (runs before the per-test logs only have the whole run's console log, see Files)."));
        return;
      }
      mount(logHost, logView(await fetchText(t.logUrl), t.logUrl));
    } catch (err) {
      mount(logHost, errorBox(err));
    }
  });
  if (selected) {
    item.open = true; // loads the log via the toggle event
    requestAnimationFrame(() => item.scrollIntoView({ block: "start" }));
  }
  return h("li", {}, item);
}

// What a test recorded (record_property), shown above its log
function propertiesTable(properties) {
  return h("table", { class: "test-properties" },
    h("tbody", {}, properties.map(([name, value]) =>
      h("tr", {}, h("th", { scope: "row", class: "mono" }, name), h("td", { class: "mono" }, value)))));
}

// full: the log is the whole page (no height limit)
export function logView(text, url, { full = false } = {}) {
  const lines = logLines(text);
  let showLog = false;
  const pre = h("pre", { class: full ? "log full" : "log" });
  const render = () => {
    pre.replaceChildren(...lines.filter((l) => showLog || l.kind !== "log")
      .map((l) => h("span", { class: `l-${l.kind}` }, l.text, l.kind === "section" ? null : "\n")));
  };
  render();
  const hidden = lines.filter((l) => l.kind === "log").length;
  return h("div", { class: "log-wrap" },
    h("div", { class: "log-tools" },
      hidden ? h("label", {},
        h("input", { type: "checkbox", onchange: (e) => { showLog = e.target.checked; render(); } }),
        ` Show labgrid steps (${hidden} lines)`) : null,
      h("span", { class: "grow" }),
      h("a", { href: proxiedArtifact(url) }, "Download")),
    pre);
}
