import { describe, expect, it, vi } from "vitest";

import { MarkerSeverity } from "../../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../../platform/markers/common/markerService.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";

import { DiagnosticsCustomer } from "./diagnosticsCustomer.ts";

const RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } };
const MAIN = "file:///proj/main.ts";
const SETTINGS = "file:///proj/settings.json";

function makeRpc() {
    const handlers = new Map<string, (params: unknown) => void>();
    const sent: { method: string; params: unknown }[] = [];
    const rpc = {
        handleNotification: (method: string, handler: (params: unknown) => void) => {
            handlers.set(method, handler);
            return { dispose: () => handlers.delete(method) };
        },
        notify: (method: string, params: unknown) => {
            sent.push({ method, params });
        },
    } as unknown as HostRpc;
    const fire = (method: string, params: unknown): void => {
        handlers.get(method)?.(params);
    };
    const mirrored = () =>
        sent
            .filter((m) => m.method === "diagnostics.markersChanged")
            .map((m) => (m.params as { entries: unknown }).entries);
    return { rpc, fire, sent, mirrored };
}

function setup() {
    const markers = new MarkerService();
    const sink = vi.fn((owner: string, resource: string, wire: readonly { message: string }[]) => {
        markers.changeOne(
            owner,
            resource,
            wire.map((m) => ({ severity: MarkerSeverity.Error, range: RANGE, message: m.message })),
        );
    });
    const customer = new DiagnosticsCustomer(sink, markers);
    return { markers, sink, customer };
}

function publish(fire: (method: string, params: unknown) => void, owner: string, resource: string, message?: string) {
    const markers = message === undefined ? [] : [{ severity: 0, range: RANGE, message }];
    fire("diagnostics.publish", { owner, resource, markers });
}

describe("DiagnosticsCustomer — collection publishing", () => {
    it("a valid publish goes to the sink; a broken envelope does not", () => {
        const { sink, customer } = setup();
        const { rpc, fire } = makeRpc();
        customer.attach({ rpc, logger: undefined });

        publish(fire, "ext:ts", MAIN, "Type error");
        fire("diagnostics.publish", { owner: "", resource: MAIN, markers: [] });

        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink).toHaveBeenCalledWith("ext:ts", MAIN, [{ severity: 0, range: RANGE, message: "Type error" }]);
    });

    it("without a sink and marker reader a publish is dropped silently", () => {
        const customer = new DiagnosticsCustomer(undefined, undefined);
        const { rpc, fire, sent } = makeRpc();
        customer.attach({ rpc, logger: undefined });
        customer.pushInitialState();

        publish(fire, "ext:ts", MAIN, "Type error");

        expect(sent).toEqual([]);
    });
});

describe("DiagnosticsCustomer — foreign markers to the subprocess", () => {
    it("seed before the first spawn — no one to send to, and no crash", () => {
        const { markers, customer } = setup();
        markers.changeOne("settings", SETTINGS, [{ severity: MarkerSeverity.Warning, range: RANGE, message: "a" }]);

        expect(() => {
            customer.pushInitialState();
        }).not.toThrow();
    });

    it("a foreign owner's marker goes as the resource's full set; severity uses vscode numbers", () => {
        const { markers, customer } = setup();
        const { rpc, mirrored } = makeRpc();
        customer.attach({ rpc, logger: undefined });

        markers.changeOne("tasks", MAIN, [
            { severity: MarkerSeverity.Error, range: RANGE, message: "e", code: "TS1", source: "tsc" },
            { severity: MarkerSeverity.Warning, range: RANGE, message: "w" },
            { severity: MarkerSeverity.Info, range: RANGE, message: "i" },
            { severity: MarkerSeverity.Hint, range: RANGE, message: "h" },
        ]);

        // Strict: a field without a value doesn't go on the wire at all.
        expect(mirrored()).toStrictEqual([
            [
                {
                    resource: MAIN,
                    markers: [
                        { severity: 0, range: RANGE, message: "e", code: "TS1", source: "tsc" },
                        { severity: 1, range: RANGE, message: "w" },
                        { severity: 2, range: RANGE, message: "i" },
                        { severity: 3, range: RANGE, message: "h" },
                    ],
                },
            ],
        ]);
    });

    it("own markers are not echoed: a resource with only own markers stays silent, next to foreign ones they are filtered", () => {
        const { markers, customer } = setup();
        const { rpc, fire, mirrored } = makeRpc();
        customer.attach({ rpc, logger: undefined });

        publish(fire, "ext:ts", MAIN, "own");
        expect(mirrored()).toEqual([]);

        markers.changeOne("tasks", MAIN, [{ severity: MarkerSeverity.Warning, range: RANGE, message: "foreign" }]);
        publish(fire, "ext:ts", MAIN, "own again");

        const foreignOnly = [{ resource: MAIN, markers: [{ severity: 1, range: RANGE, message: "foreign" }] }];
        expect(mirrored()).toEqual([foreignOnly, foreignOnly]);
    });

    it("removed foreign markers are reported as an empty set, even if own ones remain; then the resource stays silent", () => {
        const { markers, customer } = setup();
        const { rpc, fire, mirrored } = makeRpc();
        customer.attach({ rpc, logger: undefined });
        publish(fire, "ext:ts", MAIN, "own");
        markers.changeOne("tasks", MAIN, [{ severity: MarkerSeverity.Error, range: RANGE, message: "foreign" }]);

        markers.changeOne("tasks", MAIN, []);
        publish(fire, "ext:ts", MAIN, "own again");

        expect(mirrored().slice(1)).toEqual([[{ resource: MAIN, markers: [] }]]);
    });

    it("seed — resources with foreign markers, once each; own and empty ones are not sent", () => {
        const { markers, customer } = setup();
        const first = makeRpc();
        customer.attach({ rpc: first.rpc, logger: undefined });
        publish(first.fire, "ext:ts", MAIN, "own");

        const second = makeRpc();
        customer.attach({ rpc: second.rpc, logger: undefined });
        markers.changeOne("settings", SETTINGS, [
            { severity: MarkerSeverity.Warning, range: RANGE, message: "a" },
            { severity: MarkerSeverity.Info, range: RANGE, message: "b" },
        ]);
        second.sent.length = 0;
        customer.pushInitialState();

        expect(second.mirrored()).toEqual([
            [
                {
                    resource: SETTINGS,
                    markers: [
                        { severity: 1, range: RANGE, message: "a" },
                        { severity: 2, range: RANGE, message: "b" },
                    ],
                },
            ],
        ]);
    });

    it("after the spawn exits nothing is sent; a new spawn starts with an empty mirror, own owners are remembered", () => {
        const { markers, customer } = setup();
        const first = makeRpc();
        const attached = customer.attach({ rpc: first.rpc, logger: undefined });
        publish(first.fire, "ext:ts", MAIN, "own");
        markers.changeOne("tasks", MAIN, [{ severity: MarkerSeverity.Error, range: RANGE, message: "foreign" }]);
        attached.dispose();

        markers.changeOne("tasks", SETTINGS, [{ severity: MarkerSeverity.Error, range: RANGE, message: "late" }]);
        expect(first.mirrored()).toHaveLength(1);

        const second = makeRpc();
        customer.attach({ rpc: second.rpc, logger: undefined });
        // Foreign markers are removed: the new subprocess was never told about them, nothing to report.
        markers.changeOne("tasks", MAIN, []);
        // Markers of the previous spawn under its owner are own, not foreign.
        markers.changeOne("ext:ts", MAIN, [{ severity: MarkerSeverity.Error, range: RANGE, message: "stale" }]);
        expect(second.mirrored()).toEqual([]);
    });
});
