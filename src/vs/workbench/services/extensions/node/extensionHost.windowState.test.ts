import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { HostService } from "../../host/browser/hostService.ts";

interface IState {
    focused: boolean;
    active: boolean;
}

interface IReport {
    atActivate: IState;
    saved: IState;
    current: IState;
    events: (IState & { getterFocused: boolean })[];
}

const FIXTURE = extensionFixture("test.windowState", "watchesWindowState.cjs");

/** The terminal side is real (focus reports through the input parser); activity is driven by hand. */
function windowState() {
    const backend = new MockTerminalBackend();
    const host = new HostService(backend);
    const activity = new Emitter<boolean>();
    const userActivity = {
        isActive: true,
        onDidChangeIsActive: activity.event,
    };
    const setActive = (active: boolean): void => {
        userActivity.isActive = active;
        activity.fire(active);
    };
    return { backend, state: { host, userActivity }, setActive };
}

describe("ExtensionHost — window.state and onDidChangeWindowState (subprocess)", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function report(): Promise<IReport> {
        return (await harness?.commandRegistry.execute("test.windowState.report")) as IReport;
    }

    async function eventsReach(count: number): Promise<IReport> {
        let last: IReport | undefined;
        await waitUntil(`${String(count)} window state events`, () => {
            void report().then((r) => (last = r));
            return last !== undefined && last.events.length >= count;
        });
        return last!;
    }

    it(
        "activate() sees the seed: focus lost before the subprocess started reads false",
        { timeout: 60_000 },
        async () => {
            const w = windowState();
            w.backend.sendFocus(false);
            harness = await createExtensionTestHarness({ extensions: [FIXTURE], windowState: w.state });
            const r = await report();
            expect(r.atActivate).toStrictEqual({ focused: false, active: true });
            // The seed is the starting state, not a change.
            expect(r.events).toStrictEqual([]);
        },
    );

    it(
        "CSI O / CSI I: one event per transition, repeats dropped; window.state is a snapshot",
        { timeout: 60_000 },
        async () => {
            const w = windowState();
            harness = await createExtensionTestHarness({ extensions: [FIXTURE], windowState: w.state });
            // A gain with no loss before it is no change.
            w.backend.sendRaw("\x1b[I");
            w.backend.sendRaw("\x1b[O");
            w.backend.sendRaw("\x1b[O");
            w.backend.sendRaw("\x1b[I");
            const r = await eventsReach(2);
            expect(r.events).toStrictEqual([
                { focused: false, active: true, getterFocused: false },
                { focused: true, active: true, getterFocused: true },
            ]);
            w.backend.sendFocus(false);
            const after = await eventsReach(3);
            // The object saved in activate() keeps its snapshot; a fresh read follows.
            expect(after.saved).toStrictEqual({ focused: true, active: true });
            expect(after.current).toStrictEqual({ focused: false, active: true });
        },
    );

    it("activity: inactive, then active again — the payload carries the whole state", { timeout: 60_000 }, async () => {
        const w = windowState();
        harness = await createExtensionTestHarness({ extensions: [FIXTURE], windowState: w.state });
        w.backend.sendFocus(false);
        w.setActive(false);
        w.setActive(true);
        const r = await eventsReach(3);
        expect(r.events).toStrictEqual([
            { focused: false, active: true, getterFocused: false },
            { focused: false, active: false, getterFocused: false },
            { focused: false, active: true, getterFocused: false },
        ]);
    });

    it("a restarted subprocess is seeded with the current state, not true/true", { timeout: 60_000 }, async () => {
        const w = windowState();
        harness = await createExtensionTestHarness({ extensions: [FIXTURE], windowState: w.state });
        w.backend.sendFocus(false);
        w.setActive(false);
        await eventsReach(2);
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "diode-window-state-"));
        try {
            await harness.openFolder(folder);
            await harness.host.activateByEvent("*");
            const r = await report();
            expect(r.atActivate).toStrictEqual({ focused: false, active: false });
            expect(r.events).toStrictEqual([]);
        } finally {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });
});
