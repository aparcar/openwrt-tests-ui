// "Schedule a run" box: pick build, lab and tests, copy the matching
// `owci schedule` command (the page itself only reads).

import { scheduleCommand } from "../model.js";
import { h } from "../ui.js";

const TESTS = [
  ["", "All tests"],
  ["test_base.py", "Base tests"],
  ["test_base.py::test_shell", "Boot only"],
];

// device: platform; releases: official builds to offer (first = default);
// labs: labs that ran the device; initial: {release, lab, tests}
export function scheduleBox({ title, device, releases, labs, initial = {} }) {
  const choice = { release: initial.release || releases[0], lab: initial.lab || "", tests: initial.tests || "" };
  const code = h("code", {});
  const copyButton = h("button", { type: "button", class: "copy" }, "Copy");
  const update = () => { code.textContent = scheduleCommand({ device, ...choice }); };
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      copyButton.textContent = "Copied";
    } catch {
      // no clipboard (e.g. plain http): select the text instead
      getSelection().selectAllChildren(code);
      copyButton.textContent = "Press Ctrl+C";
    }
    setTimeout(() => { copyButton.textContent = "Copy"; }, 2000);
  });

  const select = (label, key, options) => h("label", { class: "field" },
    h("span", { class: "field-label" }, label),
    h("select", { onchange: (e) => { choice[key] = e.target.value; update(); } },
      options.map(([value, text]) => h("option", { value, selected: choice[key] === value }, text))));

  update();
  return h("section", { class: "schedule" },
    h("h2", {}, title),
    h("div", { class: "toolbar" },
      select("Build", "release", releases.map((r) => [r, r === "SNAPSHOT" ? "SNAPSHOT (main)" : r])),
      select("Lab", "lab", [["", "Any lab with the device"], ...labs.map((l) => [l, l])]),
      select("Tests", "tests", TESTS)),
    h("div", { class: "command" }, h("span", { class: "prompt", "aria-hidden": "true" }, "$"), code, copyButton),
    h("p", { class: "muted hint" },
      "Run it with the owci command (github.com/aparcar/owci, settings in kernelci.toml). "
      + "For your own image add --firmware <file or URL>."));
}
