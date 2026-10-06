import { describe, expect, it } from "vitest";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpSession } from "./diagnostics.ts";
import { type FinishableApp, finishHeadlessApp } from "./useApp.ts";

// Завершение теста и пост-мортем — без бинаря, на фейковой сессии: проверяем
// порядок «снимок → уборка» и то, что молчащий редактор диагностику не вешает.

const FRAME = {
    cols: 2,
    rows: 1,
    cells: [{ char: "o" }, { char: "k" }],
} as unknown as GridSnapshot;

/** Фейковое приложение, записывающее порядок обращений. */
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
    it("упавший тест: пост-мортем снимается с ещё живой сессии, уборка — после него", async () => {
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

    it("зелёный тест: только уборка, без снимка", async () => {
        const { app, calls } = fakeApp();
        const printed: string[] = [];
        await finishHeadlessApp(app, false, (text) => printed.push(text));

        expect(calls).toEqual(["dispose"]);
        expect(printed).toEqual([]);
    });

    it("сбой печати пост-мортема уборку не отменяет", async () => {
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
    it("молчащий редактор не вешает пост-мортем: каждый запрос ждёт не дольше срока", async () => {
        const never = new Promise<never>(() => undefined);
        const { app } = fakeApp({ captureFrame: () => never, getDocument: () => never });

        const started = Date.now();
        const dump = await dumpSession(app.session, { probeTimeoutMs: 20, label: "e2e failure" });

        expect(Date.now() - started).toBeLessThan(2000);
        expect(dump).toContain("── frame ── <capture failed: no reply in 20ms>");
        expect(dump).toContain("── tree ── <getDocument failed: no reply in 20ms>");
        // То, что получить можно без редактора, в отчёт всё равно попадает.
        expect(dump).toContain("boom on stderr");
    });

    it("отказ запроса попадает в отчёт причиной, а не роняет его", async () => {
        const { app } = fakeApp({
            captureFrame: () => Promise.reject(new Error("inspector socket closed with requests in flight")),
        });
        const dump = await dumpSession(app.session);
        expect(dump).toContain("── frame ── <capture failed: inspector socket closed with requests in flight>");
        expect(dump).toContain("── focus ── <none>");
    });
});
