import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import type { ICommandEvent } from "../../../../../platform/commands/common/commandRegistry.ts";

import {
    RECORD_SESSION_IDLE_MS,
    recordTerminalSession,
    TERMINAL_DEVELOPER_ACTIONS,
    type TerminalRecordingEvent,
    unescapeTerminalData,
} from "./terminalDeveloperActions.ts";

describe("Developer terminal commands — ids and titles", () => {
    it("match upstream, Developer category", () => {
        expect(TERMINAL_DEVELOPER_ACTIONS.map((a) => [a.id, a.title, a.shortTitle])).toStrictEqual([
            [
                "workbench.action.terminal.writeDataToTerminal",
                "Developer: Write Data to Terminal",
                "Write Data to Terminal",
            ],
            [
                "workbench.action.terminal.recordSession",
                "Developer: Record Terminal Session",
                "Record Terminal Session",
            ],
        ]);
    });
});

describe("unescapeTerminalData", () => {
    it.each([
        [String.raw`a\nb\rc`, "a\nb\rc"],
        [String.raw`\x1b]633;A\x07hello\r\n`, "\u001b]633;A\u0007hello\r\n"],
        [String.raw`\x1B\x1b\xFf`, "\u001b\u001bÿ"],
        [String.raw`\t \x1 \xg0 \\`, String.raw`\t \x1 \xg0 \\`],
    ])("%s", (input, expected) => {
        expect(unescapeTerminalData(input)).toBe(expected);
    });
});

describe("recordTerminalSession", () => {
    let session: FakeTerminalSurface;
    let commands: Emitter<ICommandEvent>;
    let done: ReturnType<typeof vi.fn<(events: TerminalRecordingEvent[]) => void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        session = new FakeTerminalSurface();
        commands = new Emitter<ICommandEvent>();
        done = vi.fn();
        recordTerminalSession(session, { onWillExecuteCommand: commands.event }, done);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts with the current size; every event in arrival order, by its producer", () => {
        session.emitData("\u001b]633;A\u0007$ ");
        session.write("l");
        session.sendText("ls\r");
        commands.fire({ commandId: "workbench.action.terminal.focus" });
        session.resize(100, 30);
        vi.advanceTimersByTime(RECORD_SESSION_IDLE_MS);
        expect(done.mock.calls).toStrictEqual([
            [
                [
                    { type: "resize", cols: 80, rows: 24 },
                    { type: "output", data: "\u001b]633;A\u0007$ " },
                    { type: "input", data: "l" },
                    { type: "sendText", data: "ls\r" },
                    { type: "command", id: "workbench.action.terminal.focus" },
                    { type: "resize", cols: 100, rows: 30 },
                ],
            ],
        ]);
    });

    it("every event restarts the idle timer; after the end nothing more is recorded", () => {
        vi.advanceTimersByTime(RECORD_SESSION_IDLE_MS - 1);
        session.write("a");
        vi.advanceTimersByTime(RECORD_SESSION_IDLE_MS - 1);
        expect(done).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(done).toHaveBeenCalledOnce();
        const [events] = done.mock.calls[0];
        session.write("b");
        commands.fire({ commandId: "x" });
        vi.advanceTimersByTime(RECORD_SESSION_IDLE_MS);
        expect(events).toStrictEqual([
            { type: "resize", cols: 80, rows: 24 },
            { type: "input", data: "a" },
        ]);
        expect(done).toHaveBeenCalledOnce();
    });
});
