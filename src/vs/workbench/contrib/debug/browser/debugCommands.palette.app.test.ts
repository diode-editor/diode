// The palette's debug commands while a launch session is stopped: upstream hides a command whose precondition is
// false (`commandsQuickAccess.ts` keeps only enabled items), so Disconnect and Suspend — enabled only for an attach
// session or an adapter that both suspends and terminates the debuggee — is not offered for the synthetic launch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";

describe("the command palette while a launch session is stopped", () => {
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        t = await createDebugViewletHarness(process.cwd());
        await t.startStopped();
    });

    afterEach(async () => {
        await t.dispose();
    });

    it("does not offer Debug: Disconnect and Suspend to a session that can't suspend", async () => {
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        expect(keys.getRaw("focusedSessionIsAttach")).toBeFalsy();
        expect(keys.getRaw("suspendDebuggeeSupported")).toBeFalsy();

        void t.h.commands.execute("workbench.action.showCommands", "Debug: Disconnect");
        await vi.waitFor(() => {
            expect(t.screen()).toContain(">Debug: Disconnect");
            expect(t.screen()).toContain("Debug: Disconnect ");
        });

        expect(t.screen()).not.toContain("Disconnect and Suspend");
    });
});
