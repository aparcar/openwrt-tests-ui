// Entry point: load config and static data once, then render the view for
// the current hash route (#/, #/device/<platform>, #/run/<job id>[/file/<artifact>],
// #/queue, #/manual, #/labs, #/targets, #/about).

import { loadConfig } from "./api.js";
import { errorBox, mount, route } from "./ui.js";
import { aboutView } from "./views/about.js";
import { deviceView } from "./views/device.js";
import { devicesView } from "./views/devices.js";
import { labsView } from "./views/labs.js";
import { manualView } from "./views/manual.js";
import { queueView } from "./views/queue.js";
import { fileView, runView } from "./views/run.js";
import { targetsView } from "./views/targets.js";

const main = document.getElementById("main");
let state = null;
let renderId = 0;

const routes = {
  "": { nav: "devices", view: devicesView },
  device: { nav: "devices", view: (root, s, [platform]) => deviceView(root, s, platform) },
  run: {
    nav: "devices",
    view: (root, s, [id, sub, key]) => (sub === "file" ? fileView(root, s, id, key) : runView(root, s, id)),
  },
  queue: { nav: "queue", view: queueView },
  manual: { nav: "manual", view: manualView },
  labs: { nav: "labs", view: labsView },
  targets: { nav: "targets", view: targetsView },
  about: { nav: "about", view: aboutView },
};

async function render() {
  const id = ++renderId;
  const { parts } = route();
  const r = routes[parts[0] || ""] || routes[""];
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.toggleAttribute("aria-current", a.dataset.nav === r.nav);
  });
  try {
    state ??= await loadConfig();
    applyConfig(state.config);
    if (id !== renderId) return;
    await r.view(main, state, parts.slice(1));
  } catch (err) {
    if (id === renderId) mount(main, errorBox(err));
  }
}

function applyConfig(config) {
  if (config.title) {
    document.getElementById("title").textContent = config.title;
  }
  const dash = document.getElementById("dashboard-link");
  if (config.public?.dashboard) {
    dash.href = `${config.public.dashboard}/tree?origin=openwrt`;
    dash.hidden = false;
  }
}

// Only re-render when the path changes, not for query updates (filters
// replace the query in place)
let lastPath = null;
window.addEventListener("hashchange", () => {
  const path = location.hash.split("?")[0];
  if (path === lastPath) return;
  lastPath = path;
  render().then(() => main.focus({ preventScroll: true }));
  window.scrollTo(0, 0);
});
lastPath = location.hash.split("?")[0];
render();
