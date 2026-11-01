# OpenWrt CI web UI

Static page showing OpenWrt CI's test results. It has no build step and no
backend of its own: plain HTML, CSS and ES modules that read the Maestro
(KernelCI) API.

## Pages

| Route | Page |
|---|---|
| `#/` | Devices: latest result per device and build (official runs only) |
| `#/device/<platform>` | One device: its runs and the `owci schedule` command for it |
| `#/run/<job id>` | One run: tests, logs, firmware |
| `#/queue` | Jobs waiting for a lab or running |
| `#/manual` | Runs scheduled by hand (`owci schedule`) |
| `#/labs` | Labs, their devices and how many runs ended incomplete |
| `#/targets` | OpenWrt targets with and without a device, to pick the next device to add |
| `#/about` | What OpenWrt CI is and how to take part |

Devices and labs aren't configured anywhere: they come from the jobs of the
last `recent_days`.

## Run locally

```shell
python3 web/serve.py            # against production, http://127.0.0.1:7790/
python3 web/serve.py --api http://localhost:8001 --storage http://localhost:3000
```

`serve.py` serves the files and proxies `/maestro/*` and `/storage/*`, as
Caddy does in production; neither kernelci-api nor kernelci-storage send
CORS headers. `--data <dir>` uses another `data/` directory.

## Configuration

`data/config.json`:

| Key | Meaning |
|---|---|
| `title` | Page title |
| `maestro`, `storage` | Same-origin proxy paths to the API and storage |
| `public` | Public URLs: `api` (node viewer), `storage`, `dashboard` (KernelCI), `git_commit` |
| `pool` | The shared runtime labs claim jobs from (not a lab itself) |
| `official` | Users whose runs count as official (the nightly schedule); everything else is a manual run |
| `recent_days` | How many days of jobs to load (default 14) |
| `targets` | All OpenWrt targets, `"<target>/<subtarget>": "<arch>"`, for the targets page; update it when OpenWrt adds or drops targets |

`data/labs.json` (optional) adds a description, maintainer and url per lab
and lists labs that haven't run anything yet.

## Code

- `js/app.js`: hash router, loads the config once
- `js/api.js`: Maestro client (read-only, 30 s cache)
- `js/model.js`: pure data model (jobs → runs, statuses, lanes, queue, target coverage), no DOM
- `js/inventory.js`: recent runs plus the devices and labs derived from them
- `js/ui.js`: DOM helpers; all text goes through `textContent`, never `innerHTML`
- `js/views/`: one module per page

What the scheduler and labs store in the job nodes is in
[deploy/DATA.md](../deploy/DATA.md).

## Tests

```shell
node --test web/tests/
```

## Deploy

The Ansible `sources` role copies `index.html`, `css/`, `js/` and `data/` to
the server (see [deploy/README.md](../deploy/README.md)).
