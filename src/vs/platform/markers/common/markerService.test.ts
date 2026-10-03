import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import type { IMarkerData } from "./iMarker.ts";
import { MarkerSeverity } from "./iMarker.ts";
import { MarkerService } from "./markerService.ts";

function warning(message: string): IMarkerData {
    return { severity: MarkerSeverity.Warning, range: createRange(0, 0, 0, 3), message };
}

function error(message: string): IMarkerData {
    return { severity: MarkerSeverity.Error, range: createRange(1, 0, 1, 2), message };
}

describe("MarkerService", () => {
    it("stores markers tagged with owner + resource and reads them back", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("w")]);

        const markers = service.read();
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({ owner: "settings", resource: "/a.json", message: "w" });
    });

    it("replaces the previous markers of the same owner+resource", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("first")]);
        service.changeOne("settings", "/a.json", [warning("second"), warning("third")]);

        expect(service.read({ resource: "/a.json" }).map((m) => m.message)).toEqual(["second", "third"]);
    });

    it("clears markers when passed an empty array", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("w")]);
        service.changeOne("settings", "/a.json", []);

        expect(service.read()).toEqual([]);
    });

    it("keeps other owners' markers for the same resource untouched", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("s")]);
        service.changeOne("eslint", "/a.json", [error("e")]);
        service.changeOne("settings", "/a.json", []);

        const remaining = service.read({ resource: "/a.json" });
        expect(remaining).toHaveLength(1);
        expect(remaining[0]).toMatchObject({ owner: "eslint", message: "e" });
    });

    it("keeps the owner when it still has markers for another resource", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("a")]);
        service.changeOne("settings", "/b.json", [warning("b")]);
        service.changeOne("settings", "/a.json", []); // clears one resource; owner survives via /b.json

        expect(service.read({ owner: "settings" }).map((m) => m.resource)).toEqual(["/b.json"]);
    });

    it("filters read by owner, resource and severity", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("w")]);
        service.changeOne("eslint", "/b.js", [error("e")]);

        expect(service.read({ owner: "settings" }).map((m) => m.message)).toEqual(["w"]);
        expect(service.read({ resource: "/b.js" }).map((m) => m.message)).toEqual(["e"]);
        expect(service.read({ severities: [MarkerSeverity.Error] }).map((m) => m.message)).toEqual(["e"]);
        expect(service.read({ severities: [MarkerSeverity.Hint] })).toEqual([]);
    });

    it("notifies subscribers of the changed resource, and stops after dispose", () => {
        const service = new MarkerService();
        const listener = vi.fn();
        const subscription = service.onDidChangeMarkers(listener);

        service.changeOne("settings", "/a.json", [warning("w")]);
        expect(listener).toHaveBeenCalledWith(["/a.json"]);

        subscription.dispose();
        service.changeOne("settings", "/a.json", [warning("w2")]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("notifies subscribers when a resource's markers are cleared", () => {
        const service = new MarkerService();
        service.changeOne("settings", "/a.json", [warning("w")]);
        const listener = vi.fn();
        service.onDidChangeMarkers(listener);

        service.changeOne("settings", "/a.json", []);
        expect(listener).toHaveBeenCalledExactlyOnceWith(["/a.json"]);
    });

    it("tolerates disposing a subscription twice", () => {
        const service = new MarkerService();
        const subscription = service.onDidChangeMarkers(() => {});
        subscription.dispose();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });

    it("does not fire when clearing a resource that has no markers", () => {
        const service = new MarkerService();
        const listener = vi.fn();
        service.onDidChangeMarkers(listener);

        service.changeOne("settings", "/never.json", []);
        expect(listener).not.toHaveBeenCalled();
    });
});
