// `debug.confirmOnExit`: whether closing the window with debug sessions asks, and what the answer does.

import { describe, expect, it, vi } from "vitest";

import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import type { ShutdownReason, ShutdownVeto } from "../../../services/lifecycle/browser/lifecycleService.ts";
import type { IDebugSession } from "../common/debug.ts";

import { DebugLifecycle } from "./debugLifecycle.ts";

function setup(sessions: IDebugSession[], confirmOnExit: "always" | "never", confirmed = true) {
    let veto: ShutdownVeto | undefined;
    const dispose = vi.fn();
    const confirm = vi.fn(() => Promise.resolve(confirmed));
    const lifecycle = new DebugLifecycle(
        {
            registerShutdownVeto: (v) => {
                veto = v;
                return { dispose };
            },
        },
        { getModel: () => ({ getSessions: () => sessions }) as never },
        { get: ((key: string) => (key === "debug.confirmOnExit" ? confirmOnExit : undefined)) as never },
        { confirm },
    );
    return { lifecycle, confirm, dispose, veto: (reason: ShutdownReason) => veto?.(reason) };
}

const root = mockSession();
const child = mockSession({ parentSession: root });

describe("DebugLifecycle", () => {
    it("with always and one session asks upstream's question; Stop Debugging lets the window close", async () => {
        const { veto, confirm } = setup([root], "always");

        expect(await veto("quit")).toBe(false);

        expect(confirm).toHaveBeenCalledWith({
            title: "Stop Debugging",
            message: "There is an active debug session, are you sure you want to stop it?",
            confirmLabel: "Stop Debugging",
            warning: true,
        });
    });

    it("several root sessions are named in the plural; a cancel keeps the window open", async () => {
        const second = mockSession();
        const { veto, confirm } = setup([root, child, second], "always", false);

        expect(await veto("quit")).toBe(true);

        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "There are active debug sessions, are you sure you want to stop them?",
            }),
        );
    });

    it("does not ask with never, without sessions, or on a reload", () => {
        expect(setup([root], "never").veto("quit")).toBe(false);
        expect(setup([], "always").veto("quit")).toBe(false);
        const reload = setup([root], "always");
        expect(reload.veto("reload")).toBe(false);
        expect(reload.confirm).not.toHaveBeenCalled();
    });

    it("a child session alone counts as one root session", async () => {
        const { veto, confirm } = setup([child, root], "always");

        await veto("quit");

        expect(confirm.mock.calls[0]).toEqual([
            expect.objectContaining({
                message: "There is an active debug session, are you sure you want to stop it?",
            }),
        ]);
    });

    it("dispose takes the veto away", () => {
        const { lifecycle, dispose } = setup([], "never");

        lifecycle.dispose();

        expect(dispose).toHaveBeenCalledOnce();
    });
});
