import { describe, expect, it } from "vitest";

import { APP_NAME, REPO_URL, DIODE_VERSION } from "./version.ts";

describe("Version", () => {
    it("exposes a non-empty version string", () => {
        expect(typeof DIODE_VERSION).toBe("string");
        expect(DIODE_VERSION.length).toBeGreaterThan(0);
    });

    it("falls back to the dev marker when not injected at build time", () => {
        // В тестах (vitest, без tsup `define`) глобал `__DIODE_VERSION__` отсутствует.
        expect(DIODE_VERSION).toBe("0.0.0-dev");
    });

    it("exposes app name and repo url for the About dialog", () => {
        expect(APP_NAME).toBe("Diode");
        expect(REPO_URL).toMatch(/^https:\/\//);
    });
});
