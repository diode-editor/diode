import { describe, expect, it, vi } from "vitest";

import { DirectDebugAdapter } from "./extHostDebugAdapter.ts";
import { EventEmitter } from "./vscodeTypes.ts";

describe("DirectDebugAdapter — upstream's call straight into the extension's DebugAdapter", () => {
    it("messages go both ways; stop disposes the implementation; dispose stops listening to it", () => {
        const emitter = new EventEmitter<unknown>();
        const implementation = { onDidSendMessage: emitter.event, handleMessage: vi.fn(), dispose: vi.fn() };
        const adapter = new DirectDebugAdapter(implementation as never);
        const received: unknown[] = [];
        adapter.onMessage((m) => received.push(m));

        adapter.startSession();
        adapter.sendMessage({ seq: 1, type: "request" } as DebugProtocol.ProtocolMessage);
        emitter.fire({ seq: 1, type: "event" });
        expect(implementation.handleMessage).toHaveBeenCalledWith({ seq: 1, type: "request" });
        expect(received).toEqual([{ seq: 1, type: "event" }]);

        void adapter.stopSession();
        expect(implementation.dispose).toHaveBeenCalledTimes(1);
        adapter.dispose();
        emitter.fire({ seq: 2, type: "event" });
        expect(received).toHaveLength(1);
    });
});
