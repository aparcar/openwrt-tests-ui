// About: what OpenWrt CI is, how it works, how to take part, who runs it.

import { h, link, mount } from "../ui.js";

const GITHUB = "https://github.com";
const a = (href, text) => h("a", { href }, text);

export function aboutView(root, state) {
  mount(root,
    h("article", { class: "about" },
      h("header", { class: "page-head" },
        h("div", {}, h("h1", {}, "About OpenWrt CI"),
          h("p", { class: "lede" },
            "Automatic tests of OpenWrt firmware on real hardware and in QEMU."))),

      h("section", {},
        h("h2", {}, "What it is"),
        h("p", {},
          "Every night, OpenWrt CI takes the current OpenWrt builds (the main snapshot, the stable "
          + "release and its branch snapshot), boots them on routers and boards in community labs, "
          + "and runs the ", a(`${GITHUB}/aparcar/openwrt-tests`, "openwrt-tests"), " suite on them: "
          + "boot, shell and SSH, networking, Wi-Fi, packages and more. The ",
          a(link([]), "device overview"), " shows the latest result per device and build; each "
          + "run has its console log, the log of every single test and the firmware it tested."),
        h("p", {},
          "Developers can also test their own images or a specific build on a device of their "
          + "choice. Those runs are listed under ", a(link(["manual"]), "manual runs"),
          " and kept apart from the official results, which only the nightly schedule creates.")),

      h("section", {},
        h("h2", {}, "How it works"),
        h("p", {},
          "OpenWrt CI is built on ", a("https://kernelci.org", "KernelCI"), ", the Linux kernel's "
          + "test system: its API (Maestro) holds the jobs and results, kernelci-storage the "
          + "firmware and logs, and official results also go to KCIDB and the ",
          state.config.public?.dashboard
            ? a(`${state.config.public.dashboard}/tree?origin=openwrt`, "KernelCI dashboard")
            : "KernelCI dashboard", "."),
        h("ol", {},
          h("li", {}, "A nightly schedule creates a test job per device and build, using ",
            a(`${GITHUB}/aparcar/owci`, "owci"), "."),
          h("li", {}, "Each lab runs ", a(`${GITHUB}/aparcar/kernelci-labgrid`, "kernelci-labgrid"),
            "'s agent. It picks up jobs for the devices the lab has, powers the device, boots the "
            + "firmware with ", a(`${GITHUB}/labgrid-project/labgrid`, "labgrid"),
            " and runs openwrt-tests."),
          h("li", {}, "The agent reports every test with its own log back; this page shows them."))),

      h("section", {},
        h("h2", {}, "Test your own firmware"),
        h("p", {},
          a(`${GITHUB}/aparcar/owci`, "owci"), " schedules a run of an official build or of your "
          + "own image on any device a lab has, and can wait for the result (handy in CI). "
          + "Each device page shows the command for it. You need an account: ask below.")),

      h("section", {},
        h("h2", {}, "Projects"),
        h("ul", { class: "about-links" },
          h("li", {}, a(`${GITHUB}/aparcar/openwrt-tests`, "openwrt-tests"),
            ": the test suite, device descriptions (targets) and lab setup"),
          h("li", {}, a(`${GITHUB}/aparcar/kernelci-labgrid`, "kernelci-labgrid"),
            ": the lab agent connecting labgrid labs to KernelCI"),
          h("li", {}, a(`${GITHUB}/aparcar/owci`, "owci"), ": schedule test runs from the command line or CI"),
          h("li", {}, a(`${GITHUB}/labgrid-project/labgrid`, "labgrid"), ": controls the devices in the labs"),
          h("li", {}, a("https://kernelci.org", "KernelCI"), ": the API, storage and result database underneath"),
          h("li", {}, a("https://openwrt.org", "OpenWrt"), ": the firmware under test"))),

      h("section", {},
        h("h2", {}, "Contact"),
        h("p", {},
          "OpenWrt CI was created and is run by Paul Spooren (", a(`${GITHUB}/aparcar`, "@aparcar"),
          "). For an owci account, to add a lab with your devices (see ", a(link(["labs"]), "labs"),
          "), or if something looks wrong: open an issue on ",
          a(`${GITHUB}/aparcar/openwrt-tests/issues`, "openwrt-tests"), " (tests, devices, labs) or ",
          a(`${GITHUB}/aparcar/owci/issues`, "owci"), " (scheduling), or reach out on GitHub."))));
}
