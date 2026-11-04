import { describe, expect, it } from "vitest";

import TelemetryReporter from "./telemetryReporter.ts";

describe("TelemetryReporter (null object for the vendored Merge Conflict)", () => {
    it("takes events and disposal without throwing", () => {
        const reporter = new TelemetryReporter(undefined);
        expect(() => {
            reporter.sendTelemetryEvent("mergeMarkers.accept", { resolution: "incoming" }, { count: 1 });
            reporter.dispose();
        }).not.toThrow();
        expect(reporter.aiKey).toBeUndefined();
    });
});
