import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../testing/TestApp.ts";
import { Size } from "../common/geometryPromitives.ts";
import { emptyGridSnapshot } from "../rendering/gridSnapshot.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";

import { InspectorCore, type InspectorTarget } from "./InspectorCore.ts";
import type { InspectorDriver } from "./InspectorDriver.ts";
import {
    type CaptureFrameResult,
    type GetDocumentResult,
    InspectorMethod,
    type InspectorSuccessResponse,
} from "./protocol.ts";

function makeTarget(): InspectorTarget {
    const body = new BodyElement();
    body.setContent(new BoxElement());
    const app = TestApp.create(body, new Size(10, 3)).app;
    return {
        getRoot: () => app.root,
        getFocused: () => app.focusManager?.activeElement ?? null,
    };
}

function makeDriver(overrides: Partial<InspectorDriver> = {}): InspectorDriver {
    return {
        sendKey: vi.fn(),
        sendText: vi.fn(),
        sendMouse: vi.fn(),
        resize: vi.fn(),
        captureFrame: vi.fn().mockResolvedValue(emptyGridSnapshot(4, 2)),
        waitForIdle: vi.fn().mockResolvedValue({ idle: true, frames: 0 }),
        shutdown: vi.fn(),
        ...overrides,
    };
}

describe("InspectorCore", () => {
    it("answers TUIDom.getDocument with the serialized tree", async () => {
        const core = new InspectorCore(makeTarget());

        const res = await core.dispatch({ id: 1, method: InspectorMethod.getDocument });

        expect(res.id).toBe(1);
        const result = (res as InspectorSuccessResponse).result as GetDocumentResult;
        expect(result.root?.type).toBe("BodyElement");
    });

    it("returns an error for an unknown method", async () => {
        const core = new InspectorCore(makeTarget());

        const res = await core.dispatch({ id: 2, method: "TUIDom.nope" });

        expect(res).toEqual({ id: 2, error: { message: "Unknown method: TUIDom.nope" } });
    });

    it("turns a throwing handler into an error response", async () => {
        const core = new InspectorCore(makeTarget());
        core.register("boom", () => {
            throw new Error("kaboom");
        });

        const res = await core.dispatch({ id: 3, method: "boom" });

        expect(res).toEqual({ id: 3, error: { message: "kaboom" } });
    });

    it("stringifies a non-Error thrown value", async () => {
        const core = new InspectorCore(makeTarget());
        core.register("boomStr", () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing the non-Error branch
            throw "plain";
        });

        const res = await core.dispatch({ id: 4, method: "boomStr" });

        expect(res).toEqual({ id: 4, error: { message: "plain" } });
    });

    it("awaits an async handler before replying", async () => {
        const core = new InspectorCore(makeTarget());
        core.register("slow", async () => {
            await Promise.resolve();
            return { ok: true };
        });

        const res = await core.dispatch({ id: 5, method: "slow" });

        expect((res as InspectorSuccessResponse).result).toEqual({ ok: true });
    });

    describe("with a driver", () => {
        it("does not register driver methods without a driver", async () => {
            const core = new InspectorCore(makeTarget());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.sendKey, params: { name: "a" } });

            expect(res).toEqual({ id: 1, error: { message: "Unknown method: TUIDom.sendKey" } });
        });

        it("routes sendKey to the driver", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.sendKey, params: { name: "Ctrl+P" } });

            expect(driver.sendKey).toHaveBeenCalledWith("Ctrl+P");
        });

        it("rejects sendKey with a missing name", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.sendKey, params: {} });

            expect(res).toEqual({ id: 1, error: { message: "sendKey requires a non-empty string 'name'" } });
        });

        it("rejects a driver method with non-object params", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.sendKey });

            expect(res).toEqual({ id: 1, error: { message: "Expected object params" } });
        });

        it("rejects sendText with a non-string text", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.sendText, params: { text: 5 } });

            expect(res).toEqual({ id: 1, error: { message: "sendText requires a string 'text'" } });
        });

        it("routes sendText to the driver", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.sendText, params: { text: "hello" } });

            expect(driver.sendText).toHaveBeenCalledWith("hello");
        });

        it("routes sendMouse to the driver", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "press", button: "left", x: 3, y: 4, ctrlKey: true },
            });

            expect(driver.sendMouse).toHaveBeenCalledWith({
                action: "press",
                button: "left",
                x: 3,
                y: 4,
                shiftKey: false,
                altKey: false,
                ctrlKey: true,
            });
        });

        it("passes sendMouse through without a button (wheel)", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "scroll-down", x: 0, y: 0 },
            });

            expect(driver.sendMouse).toHaveBeenCalledWith({
                action: "scroll-down",
                x: 0,
                y: 0,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
            });
        });

        it("normalizes sendMouse modifiers to booleans", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "move", button: "left", x: 1, y: 2, shiftKey: true, altKey: true },
            });

            expect(driver.sendMouse).toHaveBeenCalledWith({
                action: "move",
                button: "left",
                x: 1,
                y: 2,
                shiftKey: true,
                altKey: true,
                ctrlKey: false,
            });
        });

        it("rejects sendMouse with an unknown action", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "wiggle", x: 1, y: 1 },
            });

            expect(res).toEqual({
                id: 1,
                error: {
                    message:
                        "sendMouse requires 'action' one of: press, release, move, scroll-up, scroll-down, scroll-left, scroll-right",
                },
            });
        });

        it("rejects sendMouse with an unknown button", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "press", button: "thumb", x: 1, y: 1 },
            });

            expect(res).toEqual({
                id: 1,
                error: { message: "sendMouse 'button' must be one of: left, middle, right, none" },
            });
        });

        it("rejects sendMouse with negative or non-integer coordinates", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());
            const expected = { message: "sendMouse requires non-negative integer 'x' and 'y'" };

            const negative = await core.dispatch({
                id: 1,
                method: InspectorMethod.sendMouse,
                params: { action: "press", x: -1, y: 1 },
            });
            const fractional = await core.dispatch({
                id: 2,
                method: InspectorMethod.sendMouse,
                params: { action: "press", x: 1, y: 1.5 },
            });

            expect(negative).toEqual({ id: 1, error: expected });
            expect(fractional).toEqual({ id: 2, error: expected });
        });

        it("routes resize to the driver", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.resize, params: { cols: 100, rows: 40 } });

            expect(driver.resize).toHaveBeenCalledWith(100, 40);
        });

        it("rejects resize with non-integer dimensions", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.resize, params: { cols: 0, rows: 40 } });

            expect(res).toEqual({
                id: 1,
                error: { message: "resize requires positive integer 'cols' and 'rows'" },
            });
        });

        it("returns the captured frame", async () => {
            const frame = emptyGridSnapshot(3, 2);
            const core = new InspectorCore(
                makeTarget(),
                makeDriver({ captureFrame: vi.fn().mockResolvedValue(frame) }),
            );

            const res = await core.dispatch({ id: 1, method: InspectorMethod.captureFrame });

            const result = (res as InspectorSuccessResponse).result as CaptureFrameResult;
            expect(result.frame).toBe(frame);
        });

        it("routes shutdown to the driver", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.shutdown });

            expect(driver.shutdown).toHaveBeenCalledTimes(1);
        });

        it("routes waitForIdle with parsed params and returns its result", async () => {
            const driver = makeDriver({ waitForIdle: vi.fn().mockResolvedValue({ idle: false, frames: 12 }) });
            const core = new InspectorCore(makeTarget(), driver);

            const res = await core.dispatch({
                id: 1,
                method: InspectorMethod.waitForIdle,
                params: { quietMs: 20, timeoutMs: 500 },
            });

            expect(driver.waitForIdle).toHaveBeenCalledWith({ quietMs: 20, timeoutMs: 500 });
            expect((res as InspectorSuccessResponse).result).toEqual({ idle: false, frames: 12 });
        });

        it("waitForIdle accepts quietMs alone (no timeoutMs)", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.waitForIdle, params: { quietMs: 15 } });

            expect(driver.waitForIdle).toHaveBeenCalledWith({ quietMs: 15 });
        });

        it("waitForIdle with no params (undefined or null) passes an empty object", async () => {
            const driver = makeDriver();
            const core = new InspectorCore(makeTarget(), driver);

            await core.dispatch({ id: 1, method: InspectorMethod.waitForIdle });
            await core.dispatch({ id: 2, method: InspectorMethod.waitForIdle, params: null });

            expect(driver.waitForIdle).toHaveBeenNthCalledWith(1, {});
            expect(driver.waitForIdle).toHaveBeenNthCalledWith(2, {});
        });

        it("rejects waitForIdle with a negative quietMs", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({ id: 1, method: InspectorMethod.waitForIdle, params: { quietMs: -1 } });

            expect(res).toEqual({
                id: 1,
                error: { message: "waitForIdle 'quietMs' must be a non-negative number" },
            });
        });

        it("rejects waitForIdle with a non-finite timeoutMs", async () => {
            const core = new InspectorCore(makeTarget(), makeDriver());

            const res = await core.dispatch({
                id: 1,
                method: InspectorMethod.waitForIdle,
                params: { timeoutMs: Number.POSITIVE_INFINITY },
            });

            expect(res).toEqual({
                id: 1,
                error: { message: "waitForIdle 'timeoutMs' must be a non-negative number" },
            });
        });
    });
});
