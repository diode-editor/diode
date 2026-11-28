import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { HostService } from "../../../host/browser/hostService.ts";
import { MARK_INACTIVE_DEBOUNCE, UserActivityService } from "../../../userActivity/common/userActivityService.ts";

import { ALWAYS_FOCUSED_AND_ACTIVE, WindowStateCustomer } from "./windowStateCustomer.ts";

function setup() {
    const backend = new MockTerminalBackend();
    const host = new HostService(backend);
    const userActivity = new UserActivityService();
    const customer = new WindowStateCustomer({ host, userActivity });
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const messages: [string, unknown][] = [];
    peer.handleNotification("window.focusChanged", (params) => messages.push(["focus", params]));
    peer.handleNotification("window.activeChanged", (params) => messages.push(["active", params]));
    const attach = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { backend, userActivity, customer, messages, attach };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("WindowStateCustomer", () => {
    it("the seed carries the current focus and activity; before a spawn it is silent", async () => {
        const h = setup();
        h.customer.pushInitialState();
        h.backend.sendFocus(false);
        h.attach();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.messages).toStrictEqual([
            ["focus", { focused: false }],
            ["active", { active: true }],
        ]);
    });

    it("a terminal focus report reaches the spawn as window.focusChanged", async () => {
        const h = setup();
        h.attach();
        h.backend.sendFocus(false);
        h.backend.sendFocus(true);
        await flushMicrotasks();
        expect(h.messages).toStrictEqual([
            ["focus", { focused: false }],
            ["focus", { focused: true }],
        ]);
    });

    it("an activity change reaches the spawn as window.activeChanged", async () => {
        vi.useFakeTimers();
        const h = setup();
        h.attach();
        h.userActivity.markActive().dispose();
        vi.advanceTimersByTime(MARK_INACTIVE_DEBOUNCE);
        await flushMicrotasks();
        expect(h.messages).toStrictEqual([
            ["active", { active: true }],
            ["active", { active: false }],
        ]);
    });

    it("a dead spawn hears nothing", async () => {
        const h = setup();
        h.attach().dispose();
        h.backend.sendFocus(false);
        await flushMicrotasks();
        expect(h.messages).toStrictEqual([]);
    });

    it("the null object reads focused and active and never fires", () => {
        expect(ALWAYS_FOCUSED_AND_ACTIVE.host.hasFocus).toBe(true);
        expect(ALWAYS_FOCUSED_AND_ACTIVE.userActivity.isActive).toBe(true);
    });
});
