// Pure data model: Maestro nodes -> runs, lanes, statuses. No DOM, no fetch,
// so it can be unit tested with `node --test`.

// One run = one job node (kind=job) created by the scheduler and completed by
// a lab's labgrid-agent. Job data carries everything the overview needs:
//   data.platform, data.runtime (lab), data.device, data.kernel_revision
//   (branch, describe, commit, commit_tags), data.summary (agent >= 2026-10),
//   artifacts.{test_log,pytest_log,junit}
export function toRun(job) {
  const data = job.data || {};
  // Our fields are in data.misc (deploy/DATA.md); data.openwrt, data.pool
  // etc. are from before (Maestro drops them when a lab updates the job)
  const ow = data.misc?.openwrt || data.openwrt || {};
  const rev = data.kernel_revision || {};
  const isRelease = (rev.commit_tags || []).length > 0;
  return {
    id: job.id,
    parent: job.parent,
    name: job.name,
    platform: data.platform,
    lab: data.runtime,
    // who created the run (Maestro sets it), and why: title/url (owci)
    owner: job.owner || null,
    trigger: data.misc?.trigger || {},
    // `owci discard`: { reason, by, at }, e.g. a hardware fault; hidden
    // everywhere but its own page
    discarded: data.misc?.discarded || null,
    // set when a lab claimed the job from the shared pool (see inventory)
    pool: data.misc?.pool || data.pool || null,
    // the scheduler copies the device's name and features from its target
    // file (older jobs: none, the platform stands in)
    deviceName: ow.name || null,
    // SNAPSHOT, 25.12-SNAPSHOT, 25.12.6 or custom (scheduler, openwrtci)
    release: ow.release || releaseOf(rev.branch, rev.commit_tags),
    target: ow.target || null,
    profile: ow.profile || null,
    features: ow.features || null,
    device: data.device,
    state: job.state,
    result: job.result,
    claimed: Boolean(data.job_id),
    created: job.created,
    updated: job.updated,
    // Maestro closes the job as incomplete after this (no lab finished it)
    timeout: job.timeout,
    branch: rev.branch || "unknown",
    describe: rev.describe || rev.commit?.slice(0, 10) || "unknown",
    commit: rev.commit,
    isRelease,
    lane: laneKey(rev.branch || "unknown", isRelease),
    // in data.misc since Maestro drops unknown data fields on update
    summary: data.misc?.summary || data.summary || null,
    durationMs: data.misc?.duration_ms ?? data.duration_ms ?? null,
    errorCode: data.error_code || null,
    errorMsg: data.error_msg || null,
    artifacts: job.artifacts || {},
  };
}

// Older jobs have no data.openwrt.release: main -> SNAPSHOT, a release tag
// v25.12.6 -> 25.12.6, other openwrt-25.12 builds -> 25.12-SNAPSHOT
export function releaseOf(branch, tags = []) {
  const tag = (tags || []).find((t) => /^v\d+\.\d+\.\d+/.test(t));
  if (tag) return tag.slice(1);
  if (branch === "main") return "SNAPSHOT";
  const m = (branch || "").match(/^openwrt-(\d+\.\d+)$/);
  return m ? `${m[1]}-SNAPSHOT` : null;
}

// --- status ------------------------------------------------------------------

// queued: waiting for a lab; running: claimed; else the job result
export function status(run) {
  if (run.state !== "done") return run.claimed ? "running" : "queued";
  return run.result || "incomplete";
}

export const STATUS = {
  pass: { label: "Passed", icon: "✓", rank: 1 },
  fail: { label: "Failed", icon: "✕", rank: 4 },
  incomplete: { label: "Incomplete", icon: "!", rank: 3 },
  skip: { label: "Skipped", icon: "–", rank: 0 },
  // tests only: a known failure (pytest xfail), the reason says which issue
  xfail: { label: "Expected failure", icon: "⚑", rank: 0.5 },
  running: { label: "Running", icon: "◷", rank: 2 },
  queued: { label: "Queued", icon: "…", rank: 2 },
  none: { label: "No run", icon: "", rank: -1 },
};

// --- official and manual runs --------------------------------------------------

// Official runs: created by the nightly schedule's user (config.official,
// e.g. ["ci"]). Everything else was triggered by hand (owci). Without the
// setting every run counts as official.
export function isOfficial(run, official) {
  return !official || official.includes(run.owner);
}

// Links from run triggers come from whoever ran owci: only http(s) ones
// become links (no javascript: and the like)
export function safeUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

// --- inventory: devices and labs from the runs themselves ---------------------

// No configuration needed: each job names its device (data.platform plus
// data.openwrt name/target/profile/features) and, once claimed, its lab
// (data.runtime). Unclaimed jobs sit in the shared pool's runtime; jobs a lab
// took from the pool remember it in data.pool, so the pool is not a lab.
// labsInfo (optional data/labs.json) adds description/maintainer/url per lab
// and lists labs that have not run anything yet; knownPools (config.pool)
// covers a pool nothing was claimed from yet. Labs marked "retired" there
// are left out, even while their old runs are still recent.
export function inventory(runs, labsInfo = {}, knownPools = []) {
  const pools = new Set([...knownPools, ...runs.map((r) => r.pool)].filter(Boolean));
  const devices = new Map();
  const labs = new Map();
  const addLab = (name) => {
    if (!labs.has(name)) labs.set(name, { name, ...(labsInfo[name] || {}), platforms: new Set() });
    return labs.get(name);
  };
  Object.keys(labsInfo).filter((name) => !labsInfo[name].retired).forEach(addLab);
  for (const run of [...runs].sort(byNewest)) {
    if (!run.platform) continue;
    // newest first: the latest job's device details win; jobs without them
    // (scheduled before, or finished before they moved to data.misc) take
    // them from any other run
    if (!devices.has(run.platform)) {
      devices.set(run.platform, { platform: run.platform, name: null, target: null, profile: null,
        features: null, labs: new Set() });
    }
    const d = devices.get(run.platform);
    d.name ??= run.deviceName;
    d.target ??= run.target;
    d.profile ??= run.profile;
    d.features ??= run.features;
    const lab = labOf(run, pools);
    if (lab && !labsInfo[lab]?.retired) {
      addLab(lab).platforms.add(run.platform);
      devices.get(run.platform).labs.add(lab);
    }
  }
  for (const d of devices.values()) {
    d.name ??= d.platform;
    d.features ??= [];
  }
  return { devices, labs, pools };
}

// The lab that ran (or is running) a job; null while it waits in the pool
export function labOf(run, pools) {
  return run.lab && !pools.has(run.lab) ? run.lab : null;
}

// --- queue -----------------------------------------------------------------------

// Unfinished jobs (state != done): running ones (claimed by a lab), and the
// waiting ones grouped by device, oldest first. A waiting device no lab ran
// recently (inv.devices[...].labs empty) likely times out unrun.
export function queue(runs, inv) {
  const running = [];
  const waiting = new Map();
  for (const run of [...runs].sort((a, b) => (a.created || "").localeCompare(b.created || ""))) {
    if (run.state === "done") continue;
    if (run.claimed) {
      running.push(run);
      continue;
    }
    if (!waiting.has(run.platform)) {
      const labs = inv.devices.get(run.platform)?.labs || new Set();
      waiting.set(run.platform, { platform: run.platform, runs: [], noLab: labs.size === 0 });
    }
    waiting.get(run.platform).runs.push(run);
  }
  // devices nobody can run first, then the longest waiting
  const groups = [...waiting.values()].sort((a, b) =>
    (b.noLab - a.noLab) || (a.runs[0].created || "").localeCompare(b.runs[0].created || ""));
  return { running, waiting: groups, total: running.length + groups.reduce((n, g) => n + g.runs.length, 0) };
}

// --- lanes: one matrix column per branch and kind ----------------------------

export function laneKey(branch, isRelease) {
  return `${branch}:${isRelease ? "release" : "snapshot"}`;
}

export function laneLabel(lane) {
  const [branch, kind] = lane.split(":");
  const name = branch === "main" ? "main" : branch.replace(/^openwrt-/, "");
  return { name, kind: kind === "release" ? "Release" : "Snapshot" };
}

// "main" > "openwrt-25.12" > "openwrt-24.10"
function branchRank(branch) {
  if (branch === "main") return [Infinity];
  const m = branch.match(/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [-1];
}

export function compareLanes(a, b) {
  const [ba, ka] = a.split(":");
  const [bb, kb] = b.split(":");
  const ra = branchRank(ba);
  const rb = branchRank(bb);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const d = (rb[i] ?? 0) - (ra[i] ?? 0);
    if (d) return d;
  }
  // per branch: snapshot first, then release
  return ka === kb ? 0 : ka === "snapshot" ? -1 : 1;
}

export function byNewest(a, b) {
  return (b.created || "").localeCompare(a.created || "");
}

// Map lane -> runs (newest first)
export function groupByLane(runs) {
  const lanes = new Map();
  for (const run of [...runs].sort(byNewest)) {
    if (!lanes.has(run.lane)) lanes.set(run.lane, []);
    lanes.get(run.lane).push(run);
  }
  return lanes;
}

// The cell of the matrix: latest run of a lane, plus whether it is a new
// failure (previous finished run in the same lane passed)
export function laneCell(laneRuns) {
  if (!laneRuns || laneRuns.length === 0) return null;
  const latest = laneRuns[0];
  const previous = laneRuns.slice(1).find((r) => r.state === "done");
  const st = status(latest);
  return {
    run: latest,
    status: st,
    newFailure: (st === "fail" || st === "incomplete") && previous ? status(previous) === "pass" : false,
  };
}

// Worst status among cells, for sorting and filtering devices
export function worstStatus(cells) {
  let worst = "none";
  for (const cell of cells) {
    if (cell && STATUS[cell.status].rank > STATUS[worst].rank) worst = cell.status;
  }
  return worst;
}

// --- tests -------------------------------------------------------------------

// modules: child nodes of the job; testsByModule: module id -> its children
export function testTree(modules, testsByModule) {
  return modules
    .map((m) => ({
      id: m.id,
      name: m.name,
      result: m.result,
      tests: (testsByModule[m.id] || [])
        .map((t) => ({
          id: t.id,
          name: t.name,
          // an xfail is stored as skip with data.misc.outcome (Maestro has no
          // xfail result); its error_msg is the reason, e.g. the known issue
          result: t.data?.misc?.outcome === "xfail" ? "xfail" : t.result,
          durationMs: t.data?.misc?.duration_ms ?? t.data?.duration_ms ?? null,
          errorMsg: t.data?.error_msg || null,
          // its own log (agent: one log per test); older runs have none
          logUrl: t.artifacts?.test_log || null,
          // what the test measured (record_property), name -> value
          properties: testProperties(t.data?.misc?.properties),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// record_property values come as strings, lists as JSON: [[name, text]]
// sorted by name, lists joined with ", "
export function testProperties(properties) {
  return Object.entries(properties || {})
    .map(([name, value]) => {
      let text = String(value);
      if (text.startsWith("[")) {
        try {
          const list = JSON.parse(text);
          if (Array.isArray(list)) text = list.join(", ");
        } catch { /* show as is */ }
      }
      return [name, text];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

// xfailed are counted in skipped as well, like the agent's data.misc.summary
export function summarize(tree) {
  const s = { total: 0, passed: 0, failed: 0, skipped: 0, xfailed: 0, errors: 0 };
  for (const m of tree) {
    for (const t of m.tests) {
      s.total++;
      if (t.result === "pass") s.passed++;
      else if (t.result === "fail") s.failed++;
      else if (t.result === "skip") s.skipped++;
      else if (t.result === "xfail") { s.skipped++; s.xfailed++; }
      else s.errors++;
    }
  }
  return s;
}

// A skip or xfail reason with its issue references as links:
// [{ text }, { text, url }, ...]. "openwrt/openwrt#123", "owner/repo#123" and
// a bare "#123" (openwrt/openwrt) link to GitHub; the rest is plain text.
export function reasonParts(text) {
  const parts = [];
  const re = /(?<![\w/#])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;
  let last = 0;
  for (const m of String(text || "").matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const repo = m[1] || "openwrt/openwrt";
    parts.push({ text: m[0], url: `https://github.com/${repo}/issues/${m[2]}` });
    last = m.index + m[0].length;
  }
  if (last < String(text || "").length) parts.push({ text: text.slice(last) });
  return parts;
}

// --- logs ----------------------------------------------------------------------

// Carriage returns and terminal escape codes (colours, cursor movement) from
// the serial console, removed
export function stripTerminal(text) {
  return (text || "").replace(/\r/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[()][0-9A-B]|\x1b[=>78]/g, "");
}

// A per-test log (agent: pytest junit_logging=all) or console log, line by
// line. Console lines come as "CONSOLE    SerialDriver: <text>": shown as
// the device printed them. kind: console, log, error, section or plain.
export function logLines(text) {
  return stripTerminal(text)
    .replace(/\n+$/, "").split("\n").map((line) => {
    const consoleLine = line.match(/^CONSOLE\s+[\w.]+: ?(.*)$/);
    if (consoleLine) return { kind: "console", text: consoleLine[1] };
    if (/^-{5,} .* -{5,}$/.test(line)) return { kind: "section", text: line.replace(/^-+ | -+$/g, "") };
    if (/^(ERROR|CRITICAL)\s/.test(line) || /^E\s{2,}/.test(line) || /^Traceback /.test(line)) {
      return { kind: "error", text: line };
    }
    if (/^(DEBUG|INFO|WARNING)\s/.test(line)) return { kind: "log", text: line };
    return { kind: "plain", text: line };
  });
}

// --- live view: a running job or build -------------------------------------------

// While a lab runs a job (or a build agent builds), it uploads the new part
// of each log every few seconds as numbered chunks next to an index.json
// (deploy/DATA.md, "Live view"): logs.<name>.chunks, done, and progress
// (tests and their results; for builds the steps). The job points at it in
// data.misc.live, the kbuild in artifacts.live, until they are done.

// The index may be older than this while the job runs: then the lab or
// agent most likely stopped (or lost its connection)
export const LIVE_STALE_MS = 2 * 60_000;

export function liveIndexUrl(node) {
  return safeUrl(node?.data?.misc?.live || node?.artifacts?.live || null);
}

// chunk n (from 1) of a log next to the index
export function liveChunkUrl(indexUrl, log, n) {
  return indexUrl.replace(/index\.json$/, `${encodeURIComponent(log)}/${String(n).padStart(6, "0")}.txt`);
}

// null for what isn't an index: it is replaced on every update, so a read
// can catch it half-written (then the next poll gets it whole)
export function parseLiveIndex(text) {
  try {
    const index = JSON.parse(text);
    return index && index.v === 1 && index.logs && typeof index.logs === "object" ? index : null;
  } catch {
    return null;
  }
}

export function liveStale(index, now = Date.now()) {
  return Boolean(index && !index.done && index.updated && now - parseTime(index.updated) > LIVE_STALE_MS);
}

const PHASES = {
  fetching: "Downloading the firmware",
  starting: "Starting",
  testing: "Testing",
  reporting: "Reporting the results",
  failed: "Stopped by a lab problem",
  cancelled: "Stopped, back in the queue",
  stopped: "Stopped, back in the queue",
  done: "Finished",
};

// builds: the step's own name (build.sh: "toolchain", "packages", ...)
export const phaseLabel = (phase) => PHASES[phase] || phase || "";

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Earlier runs' test trees (testTree) -> "module/name" -> typical duration
// (median ms): what to expect of each test in a run of the same device
export function durationHistory(trees) {
  const all = new Map();
  for (const tree of trees) {
    for (const m of tree) {
      for (const t of m.tests) {
        if (t.durationMs == null) continue;
        const key = `${m.name}/${t.name}`;
        if (!all.has(key)) all.set(key, []);
        all.get(key).push(t.durationMs);
      }
    }
  }
  return new Map([...all].map(([key, values]) => [key, median(values)]));
}

// The live view's tests in pytest's order: done (with result and time),
// running (and for how long), pending; each with what it usually takes
export function liveTests(progress, history = new Map(), now = Date.now()) {
  return (progress?.tests || []).map((t) => {
    const state = t.result ? "done" : t.id === progress.current ? "running" : "pending";
    return {
      id: t.id,
      module: t.module,
      name: t.name,
      state,
      result: t.result || null,
      ms: t.ms ?? null,
      expectedMs: history.get(`${t.module}/${t.name}`) ?? null,
      elapsedMs: state === "running" && t.started ? Math.max(0, now - parseTime(t.started)) : null,
      console: t.console ?? null,
    };
  });
}

// Time left (ms): what the tests still to come usually take (a test that
// never ran before counts as a typical one), plus what the running one
// likely still needs. null without any history.
export function remainingMs(tests, history) {
  const typical = median([...(history?.values() || [])]);
  if (typical == null) return null;
  let left = 0;
  for (const t of tests) {
    if (t.state === "pending") left += t.expectedMs ?? typical;
    else if (t.state === "running") left += Math.max(0, (t.expectedMs ?? typical) - (t.elapsedMs || 0));
  }
  return left;
}

// How long runs of the device usually take (median of earlier finished
// runs), for before pytest has listed its tests
export function typicalRunMs(runs) {
  return median(runs.filter((r) => r.state === "done" && r.durationMs).map((r) => r.durationMs));
}

// The part of the console log of one test: [start, end) in bytes, end null
// for the last one (up to the end of the log so far)
export function consoleRange(tests, id) {
  const i = tests.findIndex((t) => t.id === id);
  if (i < 0 || tests[i].console == null) return null;
  const next = tests.slice(i + 1).find((t) => t.console != null);
  return [tests[i].console, next ? next.console : null];
}

// A build's steps (build.sh's "==> step" lines) and how long each took:
// until the next one began, the last one until `end` (now while it builds)
export function buildSteps(progress, end = Date.now()) {
  const steps = progress?.steps || [];
  return steps.map((s, i) => {
    const from = parseTime(s.started);
    const to = i + 1 < steps.length ? parseTime(steps[i + 1].started) : end;
    return { name: s.name, ms: Math.max(0, to - from), current: i === steps.length - 1 };
  });
}

// --- labs ----------------------------------------------------------------------

// Recent runs of a lab -> counts per status and the last activity
export function labStats(runs) {
  const counts = { pass: 0, fail: 0, incomplete: 0, skip: 0, running: 0, queued: 0 };
  let last = null;
  for (const run of runs) {
    counts[status(run)]++;
    const t = run.updated || run.created;
    if (t && (!last || t > last)) last = t;
  }
  const finished = counts.pass + counts.fail + counts.incomplete + counts.skip;
  return { counts, last, finished, infraRate: finished ? counts.incomplete / finished : 0 };
}

// --- device health: the labs' healthcheck nodes --------------------------------

// Each lab's labgrid-agent reports every device it has as a healthcheck job
// node (no parent) after each health check, on changes and every 12 h
// (deploy/DATA.md): result pass (check passed), fail (failed, or the device
// is in maintenance) or skip (no check possible), why in data.error_msg.
// They are the list of devices per lab. Reports older than this mean the lab
// lost the device (or is down); the scheduler stops scheduling it too.
export const HEALTH_MAX_AGE_H = 48;

export function toHealth(node) {
  const data = node.data || {};
  return {
    id: node.id,
    lab: data.runtime,
    owner: node.owner || null,
    platform: data.platform,
    place: data.device || null,
    result: node.result || "skip",
    reason: data.error_msg || "",
    // only when a check ran: golden image release, firmware, test counts
    check: data.misc?.healthcheck || null,
    created: node.created,
    log: node.artifacts?.test_log || null,
  };
}

// Healthcheck nodes -> lab -> platform -> the newest report of each of its
// places (data.device: a lab can have several copies of a board, each its own
// labgrid place), unavailable first, plus `offline` (no report for
// HEALTH_MAX_AGE_H) and `schedulable` (pass or skip, not offline: the lab
// runs jobs on it). A lab offers the platform while one place is schedulable
// (platformAvailable). Places that went offline while another place of the
// platform still reports are left out (removed places, and the single
// all-places report of agents from before per-place health). Only reports a
// lab made about itself count: Maestro sets the owner, a lab's API user is
// named after the lab, so nobody can report devices for another lab.
export function deviceHealth(nodes, now = Date.now()) {
  const newest = new Map(); // lab -> platform -> place -> report
  for (const report of nodes.map(toHealth)) {
    if (!report.lab || !report.platform || report.owner !== report.lab) continue;
    if (!newest.has(report.lab)) newest.set(report.lab, new Map());
    const platforms = newest.get(report.lab);
    if (!platforms.has(report.platform)) platforms.set(report.platform, new Map());
    const places = platforms.get(report.platform);
    const prev = places.get(report.place);
    if (!prev || parseTime(report.created) > parseTime(prev.created)) places.set(report.place, report);
  }
  const labs = new Map();
  for (const [lab, platforms] of newest) {
    const devices = new Map();
    for (const [platform, places] of platforms) {
      let reports = [...places.values()];
      for (const report of reports) {
        report.offline = now - parseTime(report.created) > HEALTH_MAX_AGE_H * 3600_000;
        report.schedulable = !report.offline && report.result !== "fail";
      }
      if (reports.some((r) => !r.offline)) reports = reports.filter((r) => !r.offline);
      reports.sort((a, b) => a.schedulable - b.schedulable || (a.place || "").localeCompare(b.place || ""));
      devices.set(platform, reports);
    }
    labs.set(lab, devices);
  }
  return labs;
}

// Does the lab offer the platform: one of its places' reports is schedulable
export const platformAvailable = (reports) => reports.some((r) => r.schedulable);

// A place's short name in its lab: "labgrid-fcefyn-belkin_rt3200_1" in lab
// fcefyn -> "belkin_rt3200_1"
export function placeLabel(place, lab) {
  if (!place) return "";
  for (const prefix of [`labgrid-${lab}-`, `${lab}-`]) {
    if (place.startsWith(prefix) && place.length > prefix.length) return place.slice(prefix.length);
  }
  return place;
}

// The useful line of a report's reason: pytest's summary or exit message
// without its !!!!/==== framing and exception name
export function healthReason(reason) {
  const lines = (reason || "").split("\n")
    .map((l) => l.replace(/^[\s!=]+|[\s!=]+$/g, "").replace(/^_pytest\.outcomes\.Exit:\s*/, ""))
    .filter(Boolean);
  const line = lines.pop() || "";
  return line.length > 160 ? `…${line.slice(-160)}` : line;
}

// The health of one device in every lab that has it, one report per place,
// unavailable first
export function healthOfPlatform(labs, platform) {
  return [...labs.values()].flatMap((devices) => devices.get(platform) || [])
    .sort((a, b) => a.schedulable - b.schedulable || a.lab.localeCompare(b.lab)
      || (a.place || "").localeCompare(b.place || ""));
}

// --- target coverage -------------------------------------------------------------

// Which OpenWrt targets have a device in the recent runs. targets
// (config.targets): "ath79/generic" -> "mips_24kc"; devices: inventory
// devices (d.target "ath79/generic"). One entry per main target with its
// subtargets and the devices on each; targets only the runs know (not in
// config.targets) are listed too, with arch null. Devices without a
// target (older jobs) are returned as unknown.
export function targetCoverage(targets = {}, devices = []) {
  const subtargets = new Map(Object.entries(targets).map(([t, arch]) => [t, { name: t, arch, devices: [] }]));
  const unknown = [];
  for (const d of devices) {
    if (!d.target) {
      unknown.push(d);
      continue;
    }
    if (!subtargets.has(d.target)) subtargets.set(d.target, { name: d.target, arch: null, devices: [], extra: true });
    subtargets.get(d.target).devices.push(d);
  }
  const mains = new Map();
  for (const sub of subtargets.values()) {
    const main = sub.name.split("/")[0];
    if (!mains.has(main)) mains.set(main, { name: main, subtargets: [], devices: [] });
    sub.devices.sort((a, b) => a.name.localeCompare(b.name));
    mains.get(main).subtargets.push(sub);
    mains.get(main).devices.push(...sub.devices);
  }
  const list = [...mains.values()].map((m) => ({
    ...m,
    subtargets: m.subtargets.sort((a, b) => a.name.localeCompare(b.name)),
    arches: [...new Set(m.subtargets.map((s) => s.arch).filter(Boolean))].sort(),
    covered: m.devices.length > 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
  // an architecture counts as covered if any device runs on it
  const coveredArches = new Set(list.flatMap((m) => m.subtargets.filter((s) => s.devices.length).map((s) => s.arch))
    .filter(Boolean));
  const allArches = new Set(Object.values(targets));
  return {
    targets: list,
    unknown,
    coveredArches,
    summary: {
      targets: list.length,
      covered: list.filter((m) => m.covered).length,
      subtargets: subtargets.size,
      coveredSubtargets: [...subtargets.values()].filter((s) => s.devices.length).length,
      arches: allArches.size,
      coveredArches: [...coveredArches].filter((a) => allArches.has(a)).length,
    },
  };
}

// --- scheduling ------------------------------------------------------------------

// The official builds to offer for a device: the main snapshot, then those
// its runs used (branch snapshots, then releases, newest first)
export function releasesOf(runs) {
  const seen = new Set(runs.map((r) => r.release).filter((r) => r && r !== "custom"));
  seen.add("SNAPSHOT");
  const rank = (r) => (r === "SNAPSHOT" ? 0 : r.endsWith("-SNAPSHOT") ? 1 : 2);
  return [...seen].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
}

// `owci schedule` command line (github.com/aparcar/owci); defaults left out
export function scheduleCommand({ device, release = "SNAPSHOT", lab = "", tests = "" }) {
  const quote = (v) => (/^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`);
  const parts = ["owci", "schedule", "--device", quote(device)];
  if (release && release !== "SNAPSHOT") parts.push("--release", quote(release));
  if (lab) parts.push("--lab", quote(lab));
  if (tests) parts.push("--tests", quote(tests));
  return parts.join(" ");
}

// --- formatting ----------------------------------------------------------------

// Maestro timestamps are UTC without a zone suffix
export function parseTime(iso) {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

// "3 hours ago", or for times ahead (timeouts) "in 3 hours"
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "";
  const s = Math.round((now - parseTime(iso)) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return s < 0 ? "in a minute" : "just now";
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const [unit, secs] = units.find(([, secs]) => abs >= secs);
  const n = Math.floor(abs / secs);
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return s < 0 ? `in ${text}` : `${text} ago`;
}

export function duration(ms) {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
