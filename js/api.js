// Maestro (KernelCI API) client. Read-only, no token: GET /nodes and
// /node/<id> are public. Requests go through same-origin proxy paths
// (config.maestro, config.storage) because neither kernelci-api nor
// kernelci-storage send CORS headers.

const CACHE_MS = 30_000;
const cache = new Map();

let cfg = null;

// config.json: proxy paths and public URLs. labs.json is optional: extra
// details per lab (description, maintainer, url); labs and devices
// themselves come from the jobs (see recentJobs, model.inventory).
export async function loadConfig() {
  const [config, labs] = await Promise.all([
    getJSON("data/config.json", false),
    getJSON("data/labs.json", false).catch(() => ({})),
  ]);
  cfg = config;
  return { config, labsInfo: labs.labs || {} };
}

// Test runs are job nodes named openwrt-tests; the labs' healthcheck job
// nodes (device health, see healthReports) are not runs
const RUN = { kind: "job", name: "openwrt-tests" };

// whole days keep the URL (and so the 30 s cache) stable
const since = () => new Date(Date.now() - (cfg.recent_days || 14) * 86400_000).toISOString().slice(0, 10);

// All runs of the last recent_days (default 14) in one request: the device
// matrix, the labs and the device list are built from them
export const recentJobs = () => maestro("/nodes/fast", { ...RUN, created__gt: since() });

// Every unfinished run, however old: the queue (claimed ones keep state
// "available" and get data.job_id)
export const unfinishedJobs = () => maestro("/nodes/fast", { ...RUN, state__ne: "done" });

// The labs' health reports of the last recent_days (model.deviceHealth): which
// devices each lab has and their health
export const healthReports = () => maestro("/nodes/fast", { kind: "job", name: "healthcheck", created__gt: since() });

async function getJSON(url, cached = true) {
  const hit = cached && cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  if (cached) cache.set(url, { at: Date.now(), data });
  return data;
}

function maestro(path, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  return getJSON(`${cfg.maestro.replace(/\/$/, "")}${path}${qs}`);
}

export const nodes = (params) => maestro("/nodes", params);
export const node = (id) => maestro(`/node/${encodeURIComponent(id)}`);

// Maestro returns nodes in creation order and cannot sort, so fetch the
// total first and then the last `n` (newest first).
export async function latestNodes(params, n) {
  const head = await nodes({ ...params, limit: 1 });
  if (!head.total) return [];
  const offset = Math.max(0, head.total - n);
  const page = await nodes({ ...params, limit: n, offset });
  return page.items.reverse();
}

export async function count(params) {
  return (await nodes({ ...params, limit: 1 })).total || 0;
}

export const jobsForPlatform = (platform, n) => latestNodes({ ...RUN, "data.platform": platform }, n);
export const jobsForLab = (lab, n) => latestNodes({ ...RUN, "data.runtime": lab }, n);
export const children = async (id) => (await nodes({ parent: id, limit: 500 })).items;

// Module nodes, then their tests (two levels below the job)
export async function testsOfJob(jobId) {
  const modules = await children(jobId);
  const tests = await Promise.all(modules.map((m) => children(m.id)));
  return { modules, testsByModule: Object.fromEntries(modules.map((m, i) => [m.id, tests[i]])) };
}

// The job's parent: the kbuild node with the firmware (artifacts.firmware)
// and data.openwrt (release, version_code, target, profile, image, sha256)
export const buildOfJob = (job) => (job.parent ? node(job.parent) : Promise.resolve(null));

// Earlier runs of the same device and build lane, for "previous run" links
export const jobsForPlatformBranch = (platform, branch, n) =>
  latestNodes({ ...RUN, "data.platform": platform, "data.kernel_revision.branch": branch }, n);

// The agent creates a sibling "boot" test under the build node
export async function bootOfJob(job) {
  if (!job.parent) return null;
  const items = (await nodes({ parent: job.parent, kind: "test", name: "boot", limit: 5 })).items;
  return items[0] || null;
}

// Artifact URLs point at the public storage host; fetch through the proxy
export function proxiedArtifact(url) {
  const pub = cfg?.public?.storage;
  if (url && pub && url.startsWith(pub)) return cfg.storage + url.slice(pub.length);
  return url;
}

export async function fetchText(url) {
  const res = await fetch(proxiedArtifact(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function publicLinks(jobId) {
  const p = cfg.public || {};
  return {
    viewer: p.api ? `${p.api}/viewer?node_id=${jobId}` : null,
    dashboard: p.dashboard || null,
    commit: (sha) => (p.git_commit && sha ? p.git_commit + sha : null),
  };
}
