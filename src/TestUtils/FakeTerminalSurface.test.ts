import { describe, expect, it } from "vitest";

import { FakeTerminalSurface } from "./FakeTerminalSurface.ts";

describe("FakeTerminalSurface — input like a real session", () => {
    it("write and sendText reach `writes` with their own events; after exit only onDidInputAfterExit", () => {
        const surface = new FakeTerminalSurface();
        const events: string[] = [];
        surface.onDidWriteData((data) => events.push(`input ${data}`));
        surface.onDidSendText((data) => events.push(`sendText ${data}`));
        surface.onDidInputAfterExit(() => events.push("after exit"));
        surface.write("a");
        surface.sendText("b");
        surface.isExited = true;
        surface.write("c");
        surface.sendText("d");
        expect(events).toStrictEqual(["input a", "sendText b", "after exit", "after exit"]);
        expect(surface.writes).toStrictEqual(["a", "b"]);
    });
});
