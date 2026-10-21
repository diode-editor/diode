import { describe, expect, it } from "vitest";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpSession } from "./diagnostics.ts";
import { type FinishableApp, finishHeadlessApp } from "./useApp.ts";


const FRAME = {
    cols: 2,
    rows: 1,
    cells: [{ char: "o" }, { char: "k" }],
} as unknown as GridSnapshot;

function fakeApp(over: Partial<FinishableApp["session"]> = {}): { app: FinishableApp; calls: string[] } {
    const calls: string[] = [];
    let disposed = false;
    const app: FinishableApp = {
        session: {
            captureFrame: () => {
                calls.push(disposed ? "captureFrame after dispose" : "captureFrame");
                return Promise.resolve(FRAME);
            },
            getDocument: () => {
                calls.push(disposed ? "getDocument after dispose" : "getDocument");
                return Promise.resolve({ root: null });
            },
            getStderr: () => "boom on stderr",
            ...over,
        },
        env: { root: "/tmp/diode-e2e-root" },
        dispose: () => {
            calls.push("dispose");
            disposed = true;
            return Promise.resolve();
        },
    };
    return { app, calls };
}

describe("finishHeadlessApp", () => {
    it("failed test: post-mortem is taken from the still-live session, cleanup comes after it", async () => {
        const { app, calls } = fakeApp();
        const printed: string[] = [];
        await finishHeadlessApp(app, true, (text) => printed.push(text));

        expect(calls).toEqual(["captureFrame", "getDocument", "dispose"]);
        expect(printed).toHaveLength(1);
        expect(printed[0]).toContain("# e2e failure");
        expect(printed[0]).toContain(" 0|ok");
        expect(printed[0]).toContain("boom on stderr");
        expect(printed[0]).toContain("── session root ── /tmp/diode-e2e-root");
    });

    it("passing test: cleanup only, no snapshot", async () => {
        const { app, calls } = fakeApp();
        const printed: string[] = [];
        await finishHeadlessApp(app, false, (text) => printed.push(text));

        expect(calls).toEqual(["dispose"]);
        expect(printed).toEqual([]);
    });

    it("a post-mortem print failure does not cancel cleanup", async () => {
        const { app, calls } = fakeApp();
        await expect(
            finishHeadlessApp(app, true, () => {
                throw new Error("reporter is gone");
            }),
        ).rejects.toThrow("reporter is gone");
        expect(calls).toEqual(["captureFrame", "getDocument", "dispose"]);
    });
});

describe("dumpSession", () => {
    it("a silent editor does not hang the post-mortem: each request waits at most its timeout", async () => {
        const never = new Promise<never>(() => undefined);
        const { app } = fakeApp({ captureFrame: () => never, getDocument: () => never });

        const started = Date.now();
        const dump = await dumpSession(app.session, { probeTimeoutMs: 20, label: "e2e failure" });

        expect(Date.now() - started).toBeLessThan(2000);
        expect(dump).toContain("── frame ── <capture failed: no reply in 20ms>");
        expect(dump).toContain("── tree ── <getDocument failed: no reply in 20ms>");
        // What can be obtained without the editor still goes into the report.
        expect(dump).toContain("boom on stderr");
    });

    it("a request refusal lands in the report as the reason instead of crashing it", async () => {
        const { app } = fakeApp({
            captureFrame: () => Promise.reject(new Error("inspector socket closed with requests in flight")),
        });
        const dump = await dumpSession(app.session);
        expect(dump).toContain("── frame ── <capture failed: inspector socket closed with requests in flight>");
        expect(dump).toContain("── focus ── <none>");
    });
});
