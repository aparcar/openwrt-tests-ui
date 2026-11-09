// node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareLanes, deviceHealth, duration, groupByLane, healthOfPlatform, healthReason, inventory, isOfficial, placeLabel, platformAvailable, queue, safeUrl, releaseOf, releasesOf, scheduleCommand, labOf, labStats, laneCell, laneLabel, logLines, relativeTime,
  reasonParts, STATUS, status, summarize, targetCoverage, testProperties, testTree, toRun, worstStatus,
  buildSteps, consoleRange, durationHistory, liveChunkUrl, liveIndexUrl, liveStale, liveTests, parseLiveIndex, phaseLabel, remainingMs, stripTerminal, typicalRunMs,
} from "../js/model.js";

const job = (over = {}) => ({
  id: over.id || "j1",
  parent: "b1",
  name: "openwrt-tests",
  state: "done",
  result: "pass",
  created: "2026-10-06T10:00:00.000",
  ...over,
  data: {
    platform: "qemu_x86-64",
    runtime: "aparcar-laptop",
    job_id: "aparcar-laptop:abc",
    kernel_revision: { branch: "openwrt-25.12", describe: "v25.12.5", commit: "f0a60eee", commit_tags: ["v25.12.5"] },
    ...(over.data || {}),
  },
});

test("toRun keeps the discard mark", () => {
  assert.equal(toRun(job()).discarded, null);
  const mark = { reason: "broken PSU", by: "paul", at: "2026-11-01T10:00:00+00:00" };
  assert.deepEqual(toRun(job({ data: { misc: { discarded: mark } } })).discarded, mark);
});

test("toRun maps job nodes", () => {
  const run = toRun(job({ data: { summary: { passed: 9 } } }));
  assert.equal(run.lab, "aparcar-laptop");
  assert.equal(run.platform, "qemu_x86-64");
  assert.equal(run.describe, "v25.12.5");
  assert.equal(run.isRelease, true);
  assert.equal(run.lane, "openwrt-25.12:release");
  assert.deepEqual(run.summary, { passed: 9 });
});

test("snapshots land in the snapshot lane", () => {
  const run = toRun(job({ data: { kernel_revision: { branch: "main", describe: "r36868-c459c71c4a", commit_tags: [] } } }));
  assert.equal(run.lane, "main:snapshot");
  assert.deepEqual(laneLabel(run.lane), { name: "main", kind: "Snapshot" });
});

test("status: queued, running, result", () => {
  assert.equal(status(toRun(job({ state: "available", result: null, data: { job_id: undefined } }))), "queued");
  assert.equal(status(toRun(job({ state: "available", result: null }))), "running");
  assert.equal(status(toRun(job({ result: "fail" }))), "fail");
  assert.equal(status(toRun(job({ result: null }))), "incomplete");
});

test("lanes sort main first, newest branch next, snapshot before release", () => {
  const lanes = ["openwrt-24.10:release", "openwrt-25.12:release", "main:snapshot", "openwrt-25.12:snapshot"];
  assert.deepEqual(lanes.sort(compareLanes),
    ["main:snapshot", "openwrt-25.12:snapshot", "openwrt-25.12:release", "openwrt-24.10:release"]);
});

test("laneCell flags new failures", () => {
  const runs = [
    toRun(job({ id: "new", result: "fail", created: "2026-10-06T12:00:00" })),
    toRun(job({ id: "queued", state: "available", result: null, created: "2026-10-06T11:00:00" })),
    toRun(job({ id: "old", result: "pass", created: "2026-10-05T12:00:00" })),
  ];
  const cell = laneCell(groupByLane(runs).get("openwrt-25.12:release"));
  assert.equal(cell.run.id, "new");
  assert.equal(cell.newFailure, true);
  assert.equal(laneCell([]), null);
});

test("worstStatus picks the most severe", () => {
  assert.equal(worstStatus([{ status: "pass" }, null, { status: "fail" }, { status: "queued" }]), "fail");
  assert.equal(worstStatus([null]), "none");
});

test("testTree and summarize", () => {
  const tree = testTree(
    [{ id: "m1", name: "base", result: "fail" }],
    { m1: [
      { id: "t2", name: "test_ssh", result: "fail", data: { duration_ms: 1200, error_msg: "timeout" } },
      { id: "t1", name: "test_shell", result: "pass", data: {} },
      { id: "t3", name: "test_backup", result: "skip", data: {} },
    ] },
  );
  assert.deepEqual(tree[0].tests.map((t) => t.name), ["test_backup", "test_shell", "test_ssh"]);
  assert.equal(tree[0].tests[2].errorMsg, "timeout");
  assert.deepEqual(summarize(tree), { total: 3, passed: 1, failed: 1, skipped: 1, xfailed: 0, errors: 0 });
});

test("xfail: a skip with data.misc.outcome, counted in skipped too", () => {
  const [m] = testTree([{ id: "m", name: "tls", result: "pass" }], { m: [
    { id: "t1", name: "test_revoked", result: "skip",
      data: { error_msg: "uclient-fetch checks no revocation", misc: { outcome: "xfail" } } },
    { id: "t2", name: "test_valid", result: "pass", data: {} },
    { id: "t3", name: "test_wifi", result: "skip", data: { error_msg: "no wifi" } },
  ] });
  assert.equal(m.tests[0].result, "xfail");
  assert.equal(m.tests[0].errorMsg, "uclient-fetch checks no revocation");
  assert.equal(m.tests[2].result, "skip");
  assert.deepEqual(summarize([m]), { total: 3, passed: 1, failed: 0, skipped: 2, xfailed: 1, errors: 0 });
  assert.ok(STATUS.xfail.label);
});

test("reasonParts links issue references", () => {
  assert.deepEqual(reasonParts("openwrt/openwrt#10804: odhcpd ignores it"), [
    { text: "openwrt/openwrt#10804", url: "https://github.com/openwrt/openwrt/issues/10804" },
    { text: ": odhcpd ignores it" },
  ]);
  assert.deepEqual(reasonParts("took down the radio (#24625)"), [
    { text: "took down the radio (" },
    { text: "#24625", url: "https://github.com/openwrt/openwrt/issues/24625" },
    { text: ")" },
  ]);
  assert.deepEqual(reasonParts("no issue yet"), [{ text: "no issue yet" }]);
  assert.deepEqual(reasonParts("a#1 x"), [{ text: "a#1 x" }]);
  assert.deepEqual(reasonParts(null), []);
});

test("test properties: sorted, JSON lists joined, other values as they are", () => {
  assert.deepEqual(testProperties({ used_memory: "38", probe_lan_ipv6: '["fd00::2/64", "fd00::3/64"]', board: "[x" }),
    [["board", "[x"], ["probe_lan_ipv6", "fd00::2/64, fd00::3/64"], ["used_memory", "38"]]);
  assert.deepEqual(testProperties(undefined), []);
  const [m] = testTree([{ id: "m", name: "base" }],
    { m: [{ id: "t", name: "test_free_memory", data: { misc: { properties: { used_memory: "38" } } } }] });
  assert.deepEqual(m.tests[0].properties, [["used_memory", "38"]]);
});

test("formatting", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.equal(relativeTime("2026-10-06T11:58:00.000", now), "2 minutes ago");
  assert.equal(relativeTime("2026-10-04T12:00:00Z", now), "2 days ago");
  assert.equal(duration(125000), "2m 5s");
  assert.equal(duration(42000), "42s");
});

test("logLines: console lines without their prefix, errors marked", () => {
  const lines = logLines([
    "--------------------------------- Captured Log ---------------------------------",
    "CONSOLE    SerialDriver: root@OpenWrt:~# uname -a",
    "INFO     StepLogger:  → ShellDriver.run()",
    "E       AssertionError: boom",
    "plain text",
    "",
  ].join("\n"));
  assert.deepEqual(lines.map((l) => l.kind), ["section", "console", "log", "error", "plain"]);
  assert.equal(lines[0].text, "Captured Log");
  assert.equal(lines[1].text, "root@OpenWrt:~# uname -a");
  assert.deepEqual(logLines(""), [{ kind: "plain", text: "" }]);
});

test("labStats counts runs and the share of infrastructure failures", () => {
  const stats = labStats([
    toRun(job({ id: "a", result: "pass", updated: "2026-10-06T12:00:00" })),
    toRun(job({ id: "b", result: "incomplete", updated: "2026-10-07T12:00:00" })),
    toRun(job({ id: "c", state: "available", result: null })),
  ]);
  assert.equal(stats.counts.pass, 1);
  assert.equal(stats.counts.running, 1);
  assert.equal(stats.finished, 2);
  assert.equal(stats.infraRate, 0.5);
  assert.equal(stats.last, "2026-10-07T12:00:00");
});

test("inventory: devices and labs from the runs, the pool is not a lab", () => {
  const named = { openwrt: { name: "QEMU x86-64", target: "x86/64", profile: "generic", features: ["wan_port"] } };
  const runs = [
    // claimed from the pool by lab "aparcar"
    toRun(job({ id: "a", created: "2026-10-06T12:00:00", data: { runtime: "aparcar", pool: "openwrt-labs", ...named } })),
    // still waiting in the pool
    toRun(job({ id: "b", state: "available", result: null, data: { runtime: "openwrt-labs", job_id: undefined, platform: "rpi-4" } })),
    // older job without device details
    toRun(job({ id: "c", created: "2026-10-01T12:00:00", data: { runtime: "bryan" } })),
  ];
  const inv = inventory(runs, { aparcar: { maintainer: "aparcar" }, idle: { description: "nothing run yet" } });
  assert.deepEqual([...inv.labs.keys()].sort(), ["aparcar", "bryan", "idle"]);
  assert.equal(inv.labs.get("aparcar").maintainer, "aparcar");
  assert.deepEqual([...inv.labs.get("aparcar").platforms], ["qemu_x86-64"]);
  assert.equal(inv.labs.get("idle").platforms.size, 0);
  const x86 = inv.devices.get("qemu_x86-64");
  assert.equal(x86.name, "QEMU x86-64"); // the newest job's details
  assert.deepEqual(x86.features, ["wan_port"]);
  assert.deepEqual([...x86.labs].sort(), ["aparcar", "bryan"]);
  assert.equal(inv.devices.get("rpi-4").name, "rpi-4");
  assert.equal(inv.devices.get("rpi-4").labs.size, 0);
  assert.equal(labOf(runs[1], inv.pools), null);
});

test("inventory: a configured pool before anything was claimed", () => {
  const runs = [toRun(job({ state: "available", result: null, data: { runtime: "openwrt-labs", job_id: undefined } }))];
  assert.equal(inventory(runs).labs.has("openwrt-labs"), true);
  assert.equal(inventory(runs, {}, ["openwrt-labs"]).labs.has("openwrt-labs"), false);
});

test("inventory: a retired lab is left out despite recent runs", () => {
  const runs = [toRun(job({ data: { runtime: "old-qemu" } })), toRun(job({ id: "b", data: { runtime: "aparcar" } }))];
  const inv = inventory(runs, { "old-qemu": { retired: true } });
  assert.deepEqual([...inv.labs.keys()], ["aparcar"]);
  assert.deepEqual([...inv.devices.get(runs[0].platform).labs], ["aparcar"]);
});

test("queue: running jobs, waiting ones per device, devices without a lab first", () => {
  const runs = [
    toRun(job({ id: "run", state: "available", result: null, created: "2026-10-06T09:00:00" })),
    toRun(job({ id: "w1", state: "available", result: null, created: "2026-10-06T10:00:00", data: { job_id: undefined } })),
    toRun(job({ id: "w2", state: "available", result: null, created: "2026-10-06T08:00:00", data: { job_id: undefined } })),
    toRun(job({ id: "orphan", state: "available", result: null, created: "2026-10-06T11:00:00",
      data: { job_id: undefined, platform: "rpi-4", runtime: "openwrt-labs" } })),
    toRun(job({ id: "done" })),
  ];
  const q = queue(runs, inventory(runs, {}, ["openwrt-labs"]));
  assert.deepEqual(q.running.map((r) => r.id), ["run"]);
  assert.deepEqual(q.waiting.map((g) => g.platform), ["rpi-4", "qemu_x86-64"]);
  assert.equal(q.waiting[0].noLab, true);
  assert.deepEqual(q.waiting[1].runs.map((r) => r.id), ["w2", "w1"]);
  assert.equal(q.total, 4);
});

test("relativeTime in the future", () => {
  assert.equal(relativeTime("2026-10-06T12:30:00Z", Date.parse("2026-10-06T12:00:00Z")), "in 30 minutes");
});

test("logLines strips terminal escape codes", () => {
  const lines = logLines("\x1b[0;32mOK\x1b[0m done\r\n\x1b[?25lroot@OpenWrt:~# ");
  assert.deepEqual(lines.map((l) => l.text), ["OK done", "root@OpenWrt:~# "]);
});

test("releasesOf: main snapshot first, then branch snapshots, then releases", () => {
  const runs = ["25.12.6", "25.12-SNAPSHOT", "custom", "24.10.4", "25.12.6", null].map((release) => ({ release }));
  assert.deepEqual(releasesOf(runs), ["SNAPSHOT", "25.12-SNAPSHOT", "25.12.6", "24.10.4"]);
});

test("scheduleCommand leaves defaults out and quotes", () => {
  assert.equal(scheduleCommand({ device: "openwrt_one" }), "owci schedule --device openwrt_one");
  assert.equal(scheduleCommand({ device: "rpi-4", release: "25.12.6", lab: "aparcar", tests: "test_base.py::test_shell" }),
    "owci schedule --device rpi-4 --release 25.12.6 --lab aparcar --tests test_base.py::test_shell");
  assert.equal(scheduleCommand({ device: "x", tests: "test_a.py test_b.py" }),
    "owci schedule --device x --tests 'test_a.py test_b.py'");
});

test("releaseOf from branch and tags for older jobs", () => {
  assert.equal(releaseOf("main", []), "SNAPSHOT");
  assert.equal(releaseOf("openwrt-25.12", []), "25.12-SNAPSHOT");
  assert.equal(releaseOf("openwrt-25.12", ["v25.12.6"]), "25.12.6");
  assert.equal(releaseOf("custom", []), null);
  assert.equal(toRun(job()).release, "25.12.5");
});

test("device details from data.misc.openwrt, and from any run that has them", () => {
  const misc = { misc: { openwrt: { name: "OpenWrt One", target: "mediatek/filogic", features: ["wifi"] } } };
  const runs = [
    // newest: finished before the move, details dropped by Maestro
    toRun(job({ id: "new", created: "2026-10-31T12:00:00", data: { platform: "openwrt_one" } })),
    toRun(job({ id: "old", created: "2026-10-30T12:00:00", data: { platform: "openwrt_one", ...misc } })),
  ];
  assert.equal(runs[1].deviceName, "OpenWrt One");
  const d = inventory(runs).devices.get("openwrt_one");
  assert.equal(d.name, "OpenWrt One");
  assert.equal(d.target, "mediatek/filogic");
  assert.deepEqual(d.features, ["wifi"]);
});

test("summary and durations from data.misc", () => {
  const run = toRun(job({ data: { misc: { summary: { total: 3, passed: 3 }, duration_ms: 5000 } } }));
  assert.deepEqual(run.summary, { total: 3, passed: 3 });
  assert.equal(run.durationMs, 5000);
  const tree = testTree([{ id: "m", name: "base", result: "pass" }],
    { m: [{ id: "t", name: "test_shell", result: "pass", data: { misc: { duration_ms: 1200 } } }] });
  assert.equal(tree[0].tests[0].durationMs, 1200);
});

test("official runs: created by the schedule's user; trigger from data.misc", () => {
  const ci = toRun(job({ owner: "ci" }));
  const dev = toRun(job({ owner: "aparcar", data: { misc: { trigger: { title: "mt76 fix", url: "https://x/pr/1" } } } }));
  assert.equal(isOfficial(ci, ["ci"]), true);
  assert.equal(isOfficial(dev, ["ci"]), false);
  assert.equal(isOfficial(dev, undefined), true);
  assert.deepEqual(dev.trigger, { title: "mt76 fix", url: "https://x/pr/1" });
  assert.equal(dev.owner, "aparcar");
});

test("safeUrl only passes http(s) links", () => {
  assert.equal(safeUrl("https://github.com/x/pull/1"), "https://github.com/x/pull/1");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl(undefined), null);
});

test("targetCoverage groups devices by main target", () => {
  const targets = { "ath79/generic": "mips_24kc", "ath79/nand": "mips_24kc", "x86/64": "x86_64", "zynq/generic": "arm_cortex-a9_neon" };
  const devices = [
    { platform: "tplink_c7", name: "TP-Link C7", target: "ath79/generic" },
    { platform: "qemu_x86-64", name: "QEMU x86-64", target: "x86/64" },
    { platform: "new_board", name: "New", target: "newtarget/sub" },
    { platform: "old", name: "old", target: null },
  ];
  const cov = targetCoverage(targets, devices);
  assert.deepEqual(cov.targets.map((t) => [t.name, t.covered]),
    [["ath79", true], ["newtarget", true], ["x86", true], ["zynq", false]]);
  const ath79 = cov.targets[0];
  assert.deepEqual(ath79.subtargets.map((s) => [s.name, s.devices.length]), [["ath79/generic", 1], ["ath79/nand", 0]]);
  assert.deepEqual(ath79.arches, ["mips_24kc"]);
  assert.equal(cov.targets[1].subtargets[0].extra, true);
  assert.deepEqual(cov.unknown.map((d) => d.platform), ["old"]);
  assert.deepEqual([...cov.coveredArches].sort(), ["mips_24kc", "x86_64"]);
  assert.deepEqual(cov.summary, { targets: 4, covered: 3, subtargets: 5, coveredSubtargets: 3, arches: 3, coveredArches: 2 });
});

// --- device health ---------------------------------------------------------------

const report = (over = {}) => ({
  id: over.id || "h1",
  kind: "job",
  name: "healthcheck",
  owner: "lab-a",
  state: "done",
  result: "pass",
  created: "2026-11-02T08:00:00.000",
  ...over,
  data: { platform: "openwrt_one", runtime: "lab-a", device: "labgrid-a-one", ...(over.data || {}) },
});
const NOW = Date.parse("2026-11-02T12:00:00Z");

test("deviceHealth keeps the newest report per lab and device", () => {
  const labs = deviceHealth([
    report({ id: "old", created: "2026-11-01T08:00:00.000", result: "fail", data: { error_msg: "no shell" } }),
    report({ id: "new" }),
    report({ id: "b", owner: "lab-b", result: "fail", data: { runtime: "lab-b", error_msg: "maintenance: new_psu" } }),
  ], NOW);
  const [one] = labs.get("lab-a").get("openwrt_one");
  assert.equal(one.id, "new");
  assert.equal(one.schedulable, true);
  const [b] = labs.get("lab-b").get("openwrt_one");
  assert.equal(b.reason, "maintenance: new_psu");
  assert.equal(b.schedulable, false);
  // unavailable first
  assert.deepEqual(healthOfPlatform(labs, "openwrt_one").map((r) => r.lab), ["lab-b", "lab-a"]);
});

test("deviceHealth keeps each place of a platform apart", () => {
  const place = (n, over = {}) => report({ id: `p${n}`, ...over, data: { device: `labgrid-a-one_${n}`, ...(over.data || {}) } });
  const labs = deviceHealth([
    place(1),
    place(2, { result: "fail", data: { error_msg: "no shell" } }),
    place(2, { id: "p2-old", created: "2026-11-02T07:00:00.000" }),
    place(3, { result: "skip" }),
    // an older agent's single report for all places, now offline
    report({ id: "all", created: "2026-10-30T08:00:00.000", data: { device: "labgrid-a-one_1, labgrid-a-one_2" } }),
  ], NOW);
  const reports = labs.get("lab-a").get("openwrt_one");
  assert.deepEqual(reports.map((r) => r.id), ["p2", "p1", "p3"]); // unavailable first
  assert.equal(platformAvailable(reports), true);
  assert.equal(platformAvailable(reports.slice(0, 1)), false);
  assert.deepEqual(healthOfPlatform(labs, "openwrt_one").map((r) => r.id), ["p2", "p1", "p3"]);
});

test("deviceHealth keeps an offline place while no other place reports", () => {
  const labs = deviceHealth([report({ created: "2026-10-30T08:00:00.000" })], NOW);
  const [one] = labs.get("lab-a").get("openwrt_one");
  assert.equal(one.offline, true);
});

test("placeLabel drops the lab prefix", () => {
  assert.equal(placeLabel("labgrid-fcefyn-belkin_rt3200_1", "fcefyn"), "belkin_rt3200_1");
  assert.equal(placeLabel("aparcar-qemu_x86-64", "aparcar"), "qemu_x86-64");
  assert.equal(placeLabel("other-place", "fcefyn"), "other-place");
  assert.equal(placeLabel(null, "fcefyn"), "");
});

test("deviceHealth ignores reports a lab made for another lab", () => {
  const labs = deviceHealth([report({ owner: "paul" })], NOW);
  assert.equal(labs.size, 0);
});

test("deviceHealth: old reports are offline, skipped checks are schedulable", () => {
  const labs = deviceHealth([
    report({ created: "2026-10-30T08:00:00.000" }),
    report({ id: "q", result: "skip", data: { platform: "qemu_x86-64", error_msg: "no health check" } }),
  ], NOW);
  const [one] = labs.get("lab-a").get("openwrt_one");
  assert.equal(one.offline, true);
  assert.equal(one.schedulable, false);
  assert.equal(labs.get("lab-a").get("qemu_x86-64")[0].schedulable, true);
});

test("healthReason drops pytest's framing", () => {
  assert.equal(healthReason("x\n!!!!!!!!!! _pytest.outcomes.Exit: Failed to transition to state shell !!!!!!!!!!\n"),
    "Failed to transition to state shell");
  assert.equal(healthReason("============== 1 passed, 2 warnings, 1 error in 159.48s (0:02:39) =============="),
    "1 passed, 2 warnings, 1 error in 159.48s (0:02:39)");
  assert.equal(healthReason("maintenance: USB power issues"), "maintenance: USB power issues");
  assert.equal(healthReason(""), "");
});

// --- live view ---

test("live view: where it is, its chunks, the index", () => {
  const url = "https://storage.example.org/logs/lab/j1/live/index.json";
  assert.equal(liveIndexUrl({ data: { misc: { live: url } } }), url);
  assert.equal(liveIndexUrl({ artifacts: { live: url } }), url);
  assert.equal(liveIndexUrl({ data: { misc: { live: "javascript:alert(1)" } } }), null);
  assert.equal(liveIndexUrl({ data: {} }), null);
  assert.equal(liveChunkUrl(url, "console", 12), "https://storage.example.org/logs/lab/j1/live/console/000012.txt");
  assert.equal(parseLiveIndex('{"v":1,"logs":{}}').v, 1);
  assert.equal(parseLiveIndex('{"v":1,"lo'), null); // caught while being replaced
  assert.equal(parseLiveIndex('{"v":2,"logs":{}}'), null);
  const now = Date.parse("2026-11-09T10:10:00Z");
  assert.equal(liveStale({ done: false, updated: "2026-11-09T10:09:30Z" }, now), false);
  assert.equal(liveStale({ done: false, updated: "2026-11-09T10:00:00Z" }, now), true);
  assert.equal(liveStale({ done: true, updated: "2026-11-09T10:00:00Z" }, now), false);
  assert.equal(phaseLabel("fetching"), "Downloading the firmware");
  assert.equal(phaseLabel("toolchain"), "toolchain");
});

test("live view: tests with history and the time left", () => {
  const leaf = (name, durationMs) => ({ name, durationMs });
  const history = durationHistory([
    [{ name: "base", tests: [leaf("test_shell", 30_000), leaf("test_ssh", 4_000)] }],
    [{ name: "base", tests: [leaf("test_shell", 50_000), leaf("test_ssh", 6_000)] }],
    [{ name: "base", tests: [leaf("test_shell", 40_000), leaf("test_ssh", null)] }],
  ]);
  assert.equal(history.get("base/test_shell"), 40_000);
  assert.equal(history.get("base/test_ssh"), 5_000);

  const now = Date.parse("2026-11-09T10:00:10Z");
  const progress = {
    current: "tests/test_base.py::test_ssh",
    tests: [
      { id: "tests/test_base.py::test_shell", module: "base", name: "test_shell", result: "pass", ms: 35_000, console: 0 },
      { id: "tests/test_base.py::test_ssh", module: "base", name: "test_ssh", started: "2026-11-09T10:00:08Z", console: 900 },
      { id: "tests/test_new.py::test_x", module: "new", name: "test_x" },
    ],
  };
  const tests = liveTests(progress, history, now);
  assert.deepEqual(tests.map((t) => t.state), ["done", "running", "pending"]);
  assert.equal(tests[1].elapsedMs, 2_000);
  assert.equal(tests[1].expectedMs, 5_000);
  assert.equal(tests[2].expectedMs, null);
  // running: 5 s expected - 2 s so far; new test: the median of known ones (22.5 s)
  assert.equal(remainingMs(tests, history), 3_000 + 22_500);
  assert.equal(remainingMs(tests, new Map()), null);
  assert.deepEqual(consoleRange(progress.tests, "tests/test_base.py::test_shell"), [0, 900]);
  assert.deepEqual(consoleRange(progress.tests, "tests/test_base.py::test_ssh"), [900, null]);
  assert.equal(consoleRange(progress.tests, "tests/test_new.py::test_x"), null);
  assert.equal(typicalRunMs([{ state: "done", durationMs: 100 }, { state: "done", durationMs: 300 },
    { state: "available", durationMs: null }]), 200);
});

test("live view: build steps take until the next one", () => {
  const steps = buildSteps({ steps: [
    { name: "tools", started: "2026-11-09T10:00:00Z" },
    { name: "toolchain", started: "2026-11-09T10:02:00Z" },
  ] }, Date.parse("2026-11-09T10:05:00Z"));
  assert.deepEqual(steps, [
    { name: "tools", ms: 120_000, current: false },
    { name: "toolchain", ms: 180_000, current: true },
  ]);
  assert.equal(stripTerminal("a\r\n\x1b[1;32mok\x1b[0m"), "a\nok");
});
