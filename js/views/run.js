// One run (job node): what was tested where, the result per test with its
// own log, and links to the whole run's files.
//
// A running job (one with a live view, model.liveIndexUrl) gets the same
// page: the same head, facts, files and test list, filled in as the lab
// reports (views/live.js polls, views/tests.js updates the list in place).
// Once the job is done the page reloads with the results, in the same places.

import { bootOfJob, buildOfJob, clearCache, fetchText, jobsForPlatformBranch, node, proxiedArtifact, publicLinks, testsOfJob } from "../api.js";
import {
  bootTest, duration, isOfficial, labOf, liveIndexUrl, liveTree, logLines, parseTime, releasesOf, remainingMs, safeUrl,
  splitFailure, status, summarize, testTree, toRun,
} from "../model.js";
import { countsBar, emptyState, errorBox, h, link, mount, route, statusBadge, timeAgo } from "../ui.js";
import { buildSection, followingLog, liveHeadline, LiveRun } from "./live.js";
import { scheduleBox } from "./schedule.js";
import { testList } from "./tests.js";

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
  const selected = route().query.get("test");

  // Neighbours in the same lane (same branch, release or snapshot)
  const lane = history.map(toRun).filter((r) => r.lane === run.lane && (!r.discarded || r.id === id));
  const at = lane.findIndex((r) => r.id === id);
  const older = at >= 0 ? lane[at + 1] : null;
  const newer = at > 0 ? lane[at - 1] : null;

  // Once a running job (or its build) is done: this page again, with the results
  const reload = () => {
    clearCache();
    if (route().parts[0] === "run" && route().parts[1] === id && !route().parts[2]) runView(root, state, id);
  };
  const isLive = st === "running" && liveIndexUrl(job) && !tree.length;
  const page = h("div", {});
  const alive = () => page.isConnected;

  const headStatus = h("div", { class: "head-status" }, statusBadge(st), counts ? countsBar(counts) : null);
  const headline = h("p", { class: "live-line", "aria-live": "polite" });
  const durationValue = h("span", {}, run.durationMs != null ? duration(run.durationMs) : "—");
  const fileLinks = h("div", { class: "file-links" });
  const testsBody = h("div", {});
  // The boot log: the first test's log (live: its part of the console), or
  // for runs without per-test logs the whole console (the boot node's)
  const firstTest = bootTest(tree);
  const bootLogUrl = boot?.artifacts?.test_log || null;
  let liveRun = null;
  const bootSec = isLive
    ? bootSection(() => followingLog(liveRun, () => liveRun.consoleOf(liveRun.progress.tests?.[0]?.id),
      { empty: "No console output yet." }))
    : firstTest || boot
      ? bootSection(async () => (firstTest?.logUrl ? finishedLog(firstTest)
        : bootLogUrl ? logView(await fetchText(bootLogUrl), bootLogUrl)
          : h("p", { class: "muted" }, "No boot log.")))
      : null;
  if (isLive) bootSec.update("pending", "not started yet");
  else if (bootSec) {
    bootSec.update(boot?.result || firstTest?.result,
      firstTest?.logUrl ? `until the shell prompt, from ${firstTest.name}` : bootLogUrl ? "the whole console log" : null);
  }

  const files = (live) => [
    Object.entries(TEXT_FILES).map(([key, label]) => job.artifacts?.[key] || (live && LIVE_FILES[key])
      ? h("a", { class: "file", href: link(["run", id, "file", key]) }, label) : null),
    fileLink("Firmware ↓", build?.artifacts?.firmware, ow.sha256 ? `sha256 ${ow.sha256}` : null),
    links.viewer ? h("a", { class: "file", href: links.viewer }, "Raw node in Maestro ↗") : null,
  ];
  mount(fileLinks, files(false));

  mount(page,
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
      h("a", { href: link([]) }, "Devices"), " / ",
      h("a", { href: link(["device", run.platform]) }, device.name), " / ",
      h("span", {}, run.describe)),
    h("header", { class: `page-head run-head c-${st}` },
      h("div", {},
        h("h1", {}, device.name, " ", h("span", { class: "muted" }, "·"), " ", run.describe),
        h("p", { class: "lede" },
          run.isRelease ? "Release" : "Snapshot", " of ", h("strong", {}, run.branch),
          ow.target ? [" · ", h("span", { class: "mono" }, `${ow.target}/${ow.profile || ""}`)] : null),
        isLive ? headline : null),
      headStatus),
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
      fact("Lab", lab ? h("a", { href: link(["labs", lab]) }, lab) : h("span", { class: "muted" }, "waiting for a lab")),
      fact("Device", run.device ? h("span", { class: "mono" }, run.device) : "—"),
      fact("Firmware", ow.image ? h("span", { class: "mono wrap" }, ow.image) : "—"),
      fact("Commit", run.commit
        ? (links.commit(run.commit) ? h("a", { href: links.commit(run.commit), class: "mono" }, run.commit.slice(0, 12)) : run.commit.slice(0, 12))
        : "—"),
      fact("Triggered by", isOfficial(run, state.config.official)
        ? h("span", {}, "nightly schedule ", h("span", { class: "muted" }, `(${run.owner})`))
        : h("a", { href: link(["manual"], { by: run.owner }) }, run.owner || "—")),
      fact("Started", timeAgo(run.created)),
      fact("Duration", durationValue),
      fact("Boot", boot ? statusBadge(boot.result || "incomplete") : h("span", { class: "muted" }, "—"))),
    h("section", { class: "files" }, h("h2", {}, "Files"), fileLinks),
    build && build.state !== "done" && liveIndexUrl(build) ? buildSection(build, { alive, onDone: reload }) : null,
    bootSec?.el,
    h("section", {},
      h("div", { class: "section-head" },
        h("h2", {}, "Tests"),
        h("div", { class: "pager" },
          older ? h("a", { href: link(["run", older.id]), title: older.describe }, "← Previous build") : null,
          newer ? h("a", { href: link(["run", newer.id]), title: newer.describe }, "Next build →") : null)),
      testsBody),
    runAgain(run, lab, history.map(toRun), state),
  );
  mount(root, page);

  if (!isLive) {
    // a finished run, or one without a live view (older labs)
    if (tests.error) mount(testsBody, errorBox(tests.error));
    else if (tree.length) {
      const list = testList({ logFor: finishedLog, selected });
      list.update(tree);
      mount(testsBody, list.el);
    } else {
      mount(testsBody, emptyState(st === "queued" || st === "running" ? "No results yet" : "No test results",
        st === "queued" ? "Waiting for a lab with this device to pick the run up."
          : st === "running" ? `Running on ${lab}.`
            : "The run ended before any test reported. See the console log and pytest output above."));
    }
    return;
  }

  // Running: the same parts, filled in from the live view
  liveRun = new LiveRun(job, { alive, history, onDone: reload });
  const finished = (testId) => Boolean((liveRun.progress.tests || []).find((t) => t.id === testId)?.result);
  const list = testList({
    logFor: (t) => followingLog(liveRun, () => liveRun.consoleOf(t.id), {
      empty: () => (finished(t.id) ? "No console output during this test." : "No console output yet."),
    }),
    selected,
  });
  liveRun.want("console"); // the tests' logs are parts of it
  mount(fileLinks, files(true));
  let shown = false;
  liveRun.onUpdate = (r) => {
    const now = Date.now();
    const liveTests = liveTree(r.progress, r.durations, now);
    const sum = liveTests.length ? summarize(liveTests) : null;
    mount(headStatus, statusBadge("running"), sum ? countsBar(sum) : null);
    mount(headline, liveHeadline(r, liveTests.length ? remainingMs(flat(liveTests), r.durations) : null),
      r.stale ? h("span", { class: "t-fail" }, " · no update from the lab for a while") : null,
      r.problem ? h("span", { class: "muted" }, ` · ${r.problem}`) : null);
    if (r.progress.started) mount(durationValue, `${duration(now - parseTime(r.progress.started))} so far`);
    const first = bootTest(liveTests);
    if (first) bootSec.update(first.result, `until the shell prompt, from ${first.name}`);
    if (liveTests.length) {
      list.update(liveTests, { live: true });
      if (!shown) {
        mount(testsBody, list.el);
        shown = true;
      }
    } else if (r.index) {
      mount(testsBody, emptyState("No results yet", r.progress.phase === "fetching"
        ? `Running on ${lab}: downloading the firmware.` : `Running on ${lab}: starting the tests.`));
    }
  };
  liveRun.onUpdate(liveRun);
  liveRun.start();
}

// liveTree's tests as model.remainingMs wants them (state, expectedMs, elapsedMs)
function flat(tree) {
  return tree.flatMap((m) => m.tests.map((t) => ({
    state: t.result === "running" ? "running" : t.result === "pending" ? "pending" : "done",
    expectedMs: t.expectedMs,
    elapsedMs: t.result === "running" ? t.durationMs : null,
  })));
}

// A finished test's own log (agent: one per test); older runs have none.
// A failed test shows its whole failure first, the log below on request.
export async function finishedLog(t) {
  const failed = t.result === "fail" || t.result === "incomplete";
  if (!t.logUrl) {
    return h("div", {},
      failed && t.errorMsg ? failureView(t.errorMsg) : null,
      h("p", { class: "muted" },
        "No log of its own (runs before the per-test logs only have the whole run's console log, see Files)."));
  }
  const text = await fetchText(t.logUrl);
  if (!failed) return logView(text, t.logUrl);
  const { failure, log } = splitFailure(text);
  const shown = failure || t.errorMsg;
  if (!shown) return logView(text, t.logUrl);
  const rest = failure ? log : text;
  const lines = rest.trim() ? rest.split("\n").length : 0;
  const more = h("details", { class: "test-log" }, h("summary", {}, `Log (${lines} lines)`));
  more.addEventListener("toggle", () => {
    if (more.open && more.children.length === 1) more.append(logView(rest, t.logUrl));
  });
  return h("div", {}, failureView(shown, !failure), lines ? more : null);
}

// A failure in full: a traceback with its "E " lines in red, or (no
// traceback in the log) the message, all red
function failureView(text, message = false) {
  return h("pre", { class: "log failure" },
    logLines(text).map((l) => h("span", { class: message || l.kind === "error" ? "l-error" : "l-plain" }, l.text, "\n")));
}

// The boot: its result and its log. The device boots in the setup of the
// first test (model.bootTest), so that test's log starts with the boot.
// logFor() -> Element or Promise<Element>, made when it is first opened.
// update(result, note): opens by itself while booting and when the boot
// failed, unless someone opened or closed it.
function bootSection(logFor) {
  const summary = h("summary", {});
  const logHost = h("div", { class: "log-host" });
  const details = h("details", { class: "module" }, summary, logHost);
  let loaded = false;
  let touched = false;
  // the state we set ourselves: its toggle event is not someone's click
  let expected = null;
  details.addEventListener("toggle", async () => {
    if (expected !== details.open) touched = true;
    expected = null;
    if (!details.open || loaded) return;
    loaded = true;
    mount(logHost, h("p", { class: "muted" }, "Loading log…"));
    try {
      mount(logHost, await logFor());
    } catch (err) {
      loaded = false;
      mount(logHost, h("p", { class: "error" }, String(err.message || err)));
    }
  });
  const update = (result, note) => {
    details.className = `module c-${result || "incomplete"}`;
    mount(summary,
      statusBadge(result || "incomplete", { compact: true }),
      h("span", { class: "module-name" }, "Boot log"),
      note ? h("span", { class: "muted module-counts" }, note) : null);
    if (!touched && !details.open && ["running", "fail", "incomplete"].includes(result || "incomplete")) {
      expected = true;
      details.open = true;
    }
  };
  const el = h("section", {}, h("div", { class: "section-head" }, h("h2", {}, "Boot")), details);
  return { el, update };
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

// While the job runs, these come from its live view (the log of that name)
const LIVE_FILES = { test_log: "console", pytest_log: "pytest" };

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
  const head = (detail) => h("header", { class: "page-head" }, h("div", {},
    h("h1", {}, label),
    h("p", { class: "lede" }, `${run.deviceName || run.platform} · ${run.describe} · `, detail)));

  if (!url && job.state !== "done" && liveIndexUrl(job) && LIVE_FILES[key]) {
    // still running: the log as it grows, then the finished file
    const page = h("div", {});
    const detail = h("span", {}, "running, follows the end");
    const liveRun = new LiveRun(job, {
      alive: () => page.isConnected,
      onDone: () => {
        clearCache();
        if (route().parts[1] === id && route().parts[3] === key) fileView(root, state, id, key);
      },
    });
    mount(page, crumbs, head(detail),
      h("div", { class: "log-wrap" }, followingLog(liveRun, () => liveRun.log(LIVE_FILES[key])?.text || "",
        { full: true, log: LIVE_FILES[key] })));
    mount(root, page);
    liveRun.start();
    return;
  }
  if (!url) {
    mount(root, crumbs, emptyState(`No ${label.toLowerCase()}`, "This run has no such file."));
    return;
  }
  let text = await fetchText(url);
  // job definitions are compact JSON
  if (key === "job_definition") {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as is */ }
  }
  mount(root, crumbs, head(`${text.split("\n").length} lines`), logView(text, url, { full: true }));
}

function fileLink(label, url, title = null) {
  if (!url) return null;
  return h("a", { class: "file", href: proxiedArtifact(url), title }, label);
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
