// Device management functions for OpenWrt Test Dashboard

class DeviceManager {
  constructor(baseUrl, version = "") {
    this.baseUrl = baseUrl;
    this.version = version;
    this.devicesData = [];
    this.filteredDevices = [];
    this.searchTerm = "";
    this.filterType = "all";
  }

  /**
   * Get the full URL for a resource
   */
  getResourceUrl(path) {
    const versionPath = this.version ? `${this.version}/` : "";
    return `${this.baseUrl}/${versionPath}${path}`;
  }

  /**
   * Load devices data from remote server
   */
  async loadDevices() {
    try {
      Utils.clearMessages("error-container");
      Utils.showLoading("device-container", "Loading devices...");

      // Load devices.json
      const response = await fetch(this.getResourceUrl("devices.json"));
      if (!response.ok) {
        throw new Error(
          `Failed to load devices.json: ${response.status} ${response.statusText}`,
        );
      }

      this.devicesData = await response.json();

      // Load test reports for each device
      const devicePromises = this.devicesData.map(async (device) => {
        try {
          const reportResponse = await fetch(
            this.getResourceUrl(
              `results-${device.device}-${device.version_name}/report.xml`,
            ),
          );
          if (!reportResponse.ok) {
            console.warn(`Report not available for ${device.device}`);
            device.report = null;
            return device;
          }
          const reportText = await reportResponse.text();
          device.report = this.parseTestReport(reportText);
        } catch (error) {
          console.error(`Error loading data for ${device.device}:`, error);
          device.report = null;
        }
        return device;
      });

      await Promise.all(devicePromises);

      // Update UI
      this.updateStats();
      this.filterDevices();
      this.updateLastRefreshTime();

      return this.devicesData;
    } catch (error) {
      console.error("Error loading devices:", error);
      let errorMessage = `Failed to load device data from ${this.baseUrl}. `;

      if (error.message.includes("Failed to fetch")) {
        errorMessage +=
          "This might be a CORS issue or network connectivity problem.";
      } else {
        errorMessage += `Error: ${error.message}`;
      }

      Utils.showError("error-container", errorMessage);
      throw error;
    }
  }

  /**
   * Parse XML test report
   */
  parseTestReport(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    const testsuite = xmlDoc.querySelector("testsuite");
    if (!testsuite) {
      return null;
    }

    const report = {
      tests: parseInt(testsuite.getAttribute("tests") || "0"),
      failures: parseInt(testsuite.getAttribute("failures") || "0"),
      errors: parseInt(testsuite.getAttribute("errors") || "0"),
      skipped: parseInt(testsuite.getAttribute("skipped") || "0"),
      time: parseFloat(testsuite.getAttribute("time") || "0"),
      timestamp: testsuite.getAttribute("timestamp"),
      testcases: [],
    };

    // Try to find firmware version in properties
    const properties = xmlDoc.querySelectorAll("property");
    properties.forEach((property) => {
      if (property.getAttribute("name") === "firmware_version") {
        report.firmware_version = property.getAttribute("value");
      }
    });

    // Calculate passed tests
    report.passed =
      report.tests - report.failures - report.errors - report.skipped;

    // Parse individual test cases
    const testcases = xmlDoc.querySelectorAll("testcase");
    testcases.forEach((testcase) => {
      const tc = {
        classname: testcase.getAttribute("classname"),
        name: testcase.getAttribute("name"),
        time: parseFloat(testcase.getAttribute("time") || "0"),
        status: "passed",
      };

      if (testcase.querySelector("failure")) {
        tc.status = "failed";
        tc.message = testcase.querySelector("failure").getAttribute("message");
        const failureText = testcase.querySelector("failure").textContent;
        if (failureText) tc.details = failureText.trim();
      } else if (testcase.querySelector("error")) {
        tc.status = "error";
        tc.message = testcase.querySelector("error").getAttribute("message");
        const errorText = testcase.querySelector("error").textContent;
        if (errorText) tc.details = errorText.trim();
      } else if (testcase.querySelector("skipped")) {
        tc.status = "skipped";
        tc.message = testcase.querySelector("skipped").getAttribute("message");
      }

      report.testcases.push(tc);
    });

    return report;
  }

  /**
   * Update statistics display
   */
  updateStats() {
    const stats = {
      total: this.devicesData.length,
      online: this.devicesData.filter((d) => d.status === "online").length,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    };

    this.devicesData.forEach((device) => {
      if (device.report) {
        stats.totalTests += device.report.tests;
        stats.passed += device.report.passed;
        stats.failed += device.report.failures + device.report.errors;
        stats.skipped += device.report.skipped;
      }
    });

    const statsContainer = document.getElementById("stats-container");
    if (statsContainer) {
      statsContainer.innerHTML = `
                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="card stats-card total">
                        <div class="card-body">
                            <div class="d-flex align-items-center justify-content-between">
                                <div>
                                    <h2 class="mb-0">${stats.total}</h2>
                                    <p class="mb-0 small">Total Devices</p>
                                </div>
                                <i class="bi bi-router-fill fs-1 opacity-50"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="card stats-card passed">
                        <div class="card-body">
                            <div class="d-flex align-items-center justify-content-between">
                                <div>
                                    <h2 class="mb-0">${stats.passed}</h2>
                                    <p class="mb-0 small">Tests Passed</p>
                                </div>
                                <i class="bi bi-check-circle-fill fs-1 opacity-50"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="card stats-card skipped">
                        <div class="card-body">
                            <div class="d-flex align-items-center justify-content-between">
                                <div>
                                    <h2 class="mb-0">${stats.skipped}</h2>
                                    <p class="mb-0 small">Tests Skipped</p>
                                </div>
                                <i class="bi bi-skip-forward-fill fs-1 opacity-50"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="card stats-card failed">
                        <div class="card-body">
                            <div class="d-flex align-items-center justify-content-between">
                                <div>
                                    <h2 class="mb-0">${stats.failed}</h2>
                                    <p class="mb-0 small">Tests Failed</p>
                                </div>
                                <i class="bi bi-x-circle-fill fs-1 opacity-50"></i>
                            </div>
                        </div>
                    </div>
                </div>
            `;
    }
  }

  /**
   * Filter devices based on search term and filter type
   */
  filterDevices(searchTerm = this.searchTerm, filterType = this.filterType) {
    this.searchTerm = searchTerm;
    this.filterType = filterType;

    this.filteredDevices = this.devicesData.filter((device) => {
      // Search filter
      const matchesSearch =
        device.device.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (device.name &&
          device.name.toLowerCase().includes(searchTerm.toLowerCase()));

      // Status filter
      const matchesFilter =
        filterType === "all" ||
        (filterType === "failed" &&
          device.report &&
          (device.report.failures > 0 || device.report.errors > 0));

      return matchesSearch && matchesFilter;
    });

    this.renderDevices();
    this.updateFilterCount();
  }

  /**
   * Update filter count display
   */
  updateFilterCount() {
    const filterCountElement = document.getElementById("filterCount");
    if (filterCountElement) {
      const total = this.devicesData.length;
      const shown = this.filteredDevices.length;
      filterCountElement.textContent = `${shown} of ${total} devices`;
    }
  }

  /**
   * Render devices list
   */
  renderDevices() {
    const container = document.getElementById("device-container");
    if (!container) return;

    if (this.filteredDevices.length === 0) {
      container.innerHTML = `
                <div class="text-center py-5">
                    <i class="bi bi-inbox fs-1 text-muted"></i>
                    <p class="mt-2 text-muted">No devices match your filter criteria</p>
                </div>
            `;
      return;
    }

    const devicesHtml = this.filteredDevices
      .map((device) => this.createDeviceRow(device))
      .join("");
    container.innerHTML = devicesHtml;
  }

  /**
   * Create HTML for a device row
   */
  createDeviceRow(device) {
    const report = device.report;
    let statusClass = "status-loading";
    let statusBadge = '<span class="status-badge loading">No Data</span>';
    let testIndicators = "";
    let deviceStats = '<span class="text-muted">No test data available</span>';

    if (report) {
      if (report.failures === 0 && report.errors === 0) {
        statusClass = "status-pass";
        statusBadge = '<span class="status-badge pass">All Tests Passed</span>';
      } else {
        statusClass = "status-failures";
        statusBadge = '<span class="status-badge failures">Tests Failed</span>';
      }

      // Create test indicators
      const indicators = [];
      if (report.passed > 0)
        indicators.push(
          `<span class="test-indicator passed" title="Passed">${report.passed}</span>`,
        );
      if (report.skipped > 0)
        indicators.push(
          `<span class="test-indicator skipped" title="Skipped">${report.skipped}</span>`,
        );
      if (report.failures > 0)
        indicators.push(
          `<span class="test-indicator failed" title="Failed">${report.failures}</span>`,
        );
      if (report.errors > 0)
        indicators.push(
          `<span class="test-indicator error" title="Errors">${report.errors}</span>`,
        );
      testIndicators = indicators.join(" ");

      deviceStats = `
                <div class="device-stats">
                    <small class="text-muted d-block">
                        Tests: ${report.tests} | Duration: ${Utils.formatDuration(report.time)}
                    </small>
                    <small class="text-muted">
                        Firmware: ${Utils.formatFirmwareVersion(report.firmware_version, device.device)}
                    </small>
                </div>
            `;
    }

    const deviceName = device.name || device.device;
    const displayName = deviceName.replace("name:", "").trim();

    return `
            <div class="device-row ${statusClass}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-2">
                            <h5 class="mb-0 me-3">${Utils.escapeHtml(displayName)}</h5>
                            ${statusBadge}
                        </div>
                        <div class="device-info mb-2">
                            <small class="text-muted">
                                Device ID: ${Utils.escapeHtml(device.device)} |
                                Target: ${Utils.escapeHtml(device.target || "Unknown")} |
                                Proxy: ${Utils.escapeHtml(device.proxy || "Unknown")}
                            </small>
                        </div>
                        ${deviceStats}
                    </div>
                    <div class="d-flex flex-column align-items-end">
                        <div class="mb-2">
                            ${testIndicators}
                        </div>
                        <div class="btn-group btn-group-sm">
                            ${
                              report
                                ? `<button class="btn btn-outline-primary" onclick="deviceManager.showTestDetails('${device.device}')">
                                <i class="bi bi-list-ul"></i> Tests
                            </button>`
                                : ""
                            }
                            <button class="btn btn-outline-secondary" onclick="deviceManager.showBootLog('${device.device}')">
                                <i class="bi bi-terminal"></i> Boot Log
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  /**
   * Show test details modal
   */
  async showTestDetails(deviceId) {
    const device = this.devicesData.find((d) => d.device === deviceId);
    if (!device || !device.report) {
      Utils.showError(
        "error-container",
        "No test data available for this device",
      );
      return;
    }

    const modal = new bootstrap.Modal(document.getElementById("deviceModal"));
    document.getElementById("modalTitle").textContent =
      `Test Results - ${device.name || device.device}`;

    const report = device.report;
    const testcases = report.testcases || [];

    // Group tests by class
    const groupedTests = {};
    testcases.forEach((test) => {
      const className = test.classname.split(".").pop();
      if (!groupedTests[className]) {
        groupedTests[className] = [];
      }
      groupedTests[className].push(test);
    });

    let modalContent = `
            <div class="mb-4">
                <h6>Test Summary</h6>
                <div class="row">
                    <div class="col-md-3">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h5 class="card-title text-success">${report.passed}</h5>
                                <p class="card-text small">Passed</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h5 class="card-title text-warning">${report.skipped}</h5>
                                <p class="card-text small">Skipped</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h5 class="card-title text-danger">${report.failures}</h5>
                                <p class="card-text small">Failed</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h5 class="card-title text-danger">${report.errors}</h5>
                                <p class="card-text small">Errors</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

    if (Object.keys(groupedTests).length > 0) {
      modalContent += "<h6>Test Details</h6>";
      modalContent += '<div class="accordion" id="testAccordion">';

      Object.keys(groupedTests).forEach((className, index) => {
        const tests = groupedTests[className];
        const failedTests = tests.filter(
          (t) => t.status === "failed" || t.status === "error",
        );
        const passedTests = tests.filter((t) => t.status === "passed");
        const skippedTests = tests.filter((t) => t.status === "skipped");

        modalContent += `
                    <div class="accordion-item">
                        <h2 class="accordion-header" id="heading${index}">
                            <button class="accordion-button ${failedTests.length > 0 ? "" : "collapsed"}"
                                    type="button" data-bs-toggle="collapse"
                                    data-bs-target="#collapse${index}">
                                ${className}
                                <span class="badge bg-success ms-2">${passedTests.length}</span>
                                <span class="badge bg-warning ms-1">${skippedTests.length}</span>
                                <span class="badge bg-danger ms-1">${failedTests.length}</span>
                            </button>
                        </h2>
                        <div id="collapse${index}" class="accordion-collapse collapse ${failedTests.length > 0 ? "show" : ""}"
                             data-bs-parent="#testAccordion">
                            <div class="accordion-body">
                                <div class="table-responsive">
                                    <table class="table table-sm test-results-table">
                                        <thead>
                                            <tr>
                                                <th>Test Name</th>
                                                <th>Status</th>
                                                <th>Duration</th>
                                                <th>Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                `;

        tests.forEach((test) => {
          const statusClass =
            test.status === "passed"
              ? "success"
              : test.status === "skipped"
                ? "warning"
                : "danger";
          modalContent += `
                        <tr>
                            <td>${Utils.escapeHtml(test.name)}</td>
                            <td><span class="badge bg-${statusClass}">${test.status}</span></td>
                            <td>${Utils.formatDuration(test.time)}</td>
                            <td class="test-message">
                                ${this.formatTestMessage(test.message || "")}
                                ${test.details ? `<br><small class="text-muted">${Utils.escapeHtml(test.details)}</small>` : ""}
                            </td>
                        </tr>
                    `;
        });

        modalContent += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
      });

      modalContent += "</div>";
    }

    document.getElementById("modal-content").innerHTML = modalContent;
    modal.show();
  }

  /**
   * Show boot log modal
   */
  async showBootLog(deviceId) {
    const device = this.devicesData.find((d) => d.device === deviceId);
    if (!device) return;

    const modal = new bootstrap.Modal(document.getElementById("deviceModal"));
    document.getElementById("modalTitle").innerHTML = `
            Boot Log - ${device.name || device.device}
            <button class="btn btn-sm btn-outline-light ms-2" onclick="deviceManager.copyBootLog('${deviceId}')">
                <i class="bi bi-clipboard"></i> Copy
            </button>
        `;

    document.getElementById("modal-content").innerHTML = `
            <div class="text-center py-3">
                <div class="loading-spinner"></div>
                <p class="mt-2">Loading boot log...</p>
            </div>
        `;

    modal.show();

    try {
      const response = await fetch(
        this.getResourceUrl(
          `results-${device.device}-${device.version_name}/console_main`,
        ),
      );
      if (!response.ok) {
        throw new Error(`Boot log not available: ${response.status}`);
      }

      const logText = await response.text();
      const processedLog = Utils.parseAnsiCodes(Utils.escapeHtml(logText));

      document.getElementById("modal-content").innerHTML = `
                <div class="log-viewer" id="bootLog">
                    <pre class="mb-0"><code>${processedLog}</code></pre>
                </div>
            `;
    } catch (error) {
      document.getElementById("modal-content").innerHTML = `
                <div class="error-message">
                    <i class="bi bi-exclamation-triangle"></i>
                    <p>Failed to load boot log: ${error.message}</p>
                </div>
            `;
    }
  }

  /**
   * Copy boot log to clipboard
   */
  async copyBootLog(deviceId) {
    const device = this.devicesData.find((d) => d.device === deviceId);
    if (!device) return;

    try {
      const response = await fetch(
        this.getResourceUrl(
          `results-${device.device}-${device.version_name}/console_main`,
        ),
      );
      if (!response.ok) throw new Error("Failed to fetch boot log");

      const logText = await response.text();
      const success = await Utils.copyToClipboard(logText);

      if (success) {
        // Show temporary success message
        const originalTitle = document.getElementById("modalTitle").innerHTML;
        document.getElementById("modalTitle").innerHTML = `
                    <i class="bi bi-check-circle text-success"></i> Boot log copied to clipboard!
                `;
        setTimeout(() => {
          document.getElementById("modalTitle").innerHTML = originalTitle;
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to copy boot log:", error);
    }
  }

  /**
   * Format test message
   */
  formatTestMessage(message) {
    if (!message) return "";
    return Utils.parseAnsiCodes(Utils.escapeHtml(message));
  }

  /**
   * Update last refresh time
   */
  updateLastRefreshTime() {
    const lastUpdateElement = document.getElementById("last-update");
    if (lastUpdateElement) {
      const now = new Date();
      lastUpdateElement.textContent = `Last updated: ${now.toLocaleString()}`;
    }
  }

  /**
   * Refresh device data
   */
  async refresh() {
    return this.loadDevices();
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = DeviceManager;
}
