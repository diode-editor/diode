import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { HostService } from "./hostService.ts";

function setup() {
    const backend = new MockTerminalBackend();
    const host = new HostService(backend);
    const events: boolean[] = [];
    host.onDidChangeFocus((focused) => events.push(focused));
    return { backend, host, events };
}

describe("HostService — window focus from the terminal's focus reports", () => {
    it("is focused until the terminal reports otherwise", () => {
        const { host, events } = setup();
        expect(host.hasFocus).toBe(true);
        expect(events).toStrictEqual([]);
    });

    it("CSI O loses focus, CSI I regains it — one event per transition", () => {
        const { backend, host, events } = setup();
        backend.sendRaw("\x1b[O");
        expect(host.hasFocus).toBe(false);
        backend.sendRaw("\x1b[I");
        expect(host.hasFocus).toBe(true);
        expect(events).toStrictEqual([false, true]);
    });

    it("a repeated report fires nothing: two CSI O, then CSI I with no CSI O before it", () => {
        const { backend, events } = setup();
        backend.sendFocus(true);
        backend.sendFocus(false);
        backend.sendFocus(false);
        expect(events).toStrictEqual([false]);
    });
});
