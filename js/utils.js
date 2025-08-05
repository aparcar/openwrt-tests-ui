// Common utilities and configuration for OpenWrt Test Dashboard

// Configuration
const CONFIG = {
    BASE_URL: "https://aparcar.org/openwrt-tests",
    REFRESH_INTERVAL: 300000, // 5 minutes
};

// Utility functions
const Utils = {
    /**
     * Format timestamp to human readable format
     */
    formatTimestamp(timestamp) {
        if (!timestamp) return "Unknown";
        const date = new Date(timestamp);
        return date.toLocaleString();
    },

    /**
     * Format duration in seconds to human readable format
     */
    formatDuration(seconds) {
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
    },

    /**
     * Escape HTML characters
     */
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Parse ANSI color codes and convert to HTML
     */
    parseAnsiCodes(text) {
        if (!text) return "";

        const ansiRegex = /\x1b\[([0-9;]*)m/g;
        let html = text;
        let openTags = [];

        html = html.replace(ansiRegex, (match, codes) => {
            if (!codes) return "";

            const codeList = codes.split(";").map(Number);
            let result = "";

            for (const code of codeList) {
                if (code === 0) {
                    // Reset - close all tags
                    result += openTags.reverse().map(() => "</span>").join("");
                    openTags = [];
                } else if (code === 1) {
                    result += '<span class="ansi-bold">';
                    openTags.push("bold");
                } else if (code === 3) {
                    result += '<span class="ansi-italic">';
                    openTags.push("italic");
                } else if (code === 4) {
                    result += '<span class="ansi-underline">';
                    openTags.push("underline");
                } else if (code >= 30 && code <= 37) {
                    const colors = [
                        "black",
                        "red",
                        "green",
                        "yellow",
                        "blue",
                        "magenta",
                        "cyan",
                        "white",
                    ];
                    result += `<span class="ansi-${colors[code - 30]}">`;
                    openTags.push("color");
                } else if (code >= 90 && code <= 97) {
                    const colors = [
                        "bright-black",
                        "bright-red",
                        "bright-green",
                        "bright-yellow",
                        "bright-blue",
                        "bright-magenta",
                        "bright-cyan",
                        "bright-white",
                    ];
                    result += `<span class="ansi-${colors[code - 90]}">`;
                    openTags.push("bright-color");
                }
            }

            return result;
        });

        // Close any remaining open tags
        html += openTags.reverse().map(() => "</span>").join("");

        return html;
    },

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            const success = document.execCommand("copy");
            document.body.removeChild(textArea);
            return success;
        }
    },

    /**
     * Show error message
     */
    showError(containerId, message) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    ${message}
                </div>
            `;
        }
    },

    /**
     * Show success message
     */
    showSuccess(containerId, message) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-success" role="alert">
                    <i class="bi bi-check-circle-fill me-2"></i>
                    ${message}
                </div>
            `;
        }
    },

    /**
     * Clear messages
     */
    clearMessages(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = "";
        }
    },

    /**
     * Show loading state
     */
    showLoading(containerId, message = "Loading...") {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <div class="loading-spinner"></div>
                    <p class="mt-2 text-muted">${message}</p>
                </div>
            `;
        }
    },

    /**
     * Format firmware version with link if available
     */
    formatFirmwareVersion(version, device) {
        if (!version) return "Unknown";

        const shortVersion = version.length > 20
            ? version.substring(0, 20) + "..."
            : version;

        return `<span title="${Utils.escapeHtml(version)}">${Utils.escapeHtml(shortVersion)}</span>`;
    },

    /**
     * Debounce function calls
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Get URL parameters
     */
    getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {};
        for (const [key, value] of params.entries()) {
            result[key] = value;
        }
        return result;
    },

    /**
     * Update URL without page reload
     */
    updateUrl(params) {
        const url = new URL(window.location);
        Object.keys(params).forEach(key => {
            if (params[key] !== null && params[key] !== undefined && params[key] !== '') {
                url.searchParams.set(key, params[key]);
            } else {
                url.searchParams.delete(key);
            }
        });
        window.history.replaceState({}, '', url);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, Utils };
}
