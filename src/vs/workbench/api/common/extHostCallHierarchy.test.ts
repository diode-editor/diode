import { describe, expect, it } from "vitest";

import { CallHierarchySessions } from "./extHostCallHierarchy.ts";

const RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

function raw(name: string, extra: object = {}): object {
    return { name, kind: 11, detail: "", uri: "file:///a.ts", range: RANGE, selectionRange: RANGE, ...extra };
}

describe("CallHierarchySessions", () => {
    it("prepare accepts one item or an array; nothing usable means no session", () => {
        const sessions = new CallHierarchySessions();
        expect(sessions.prepare(raw("one"))?.items.map((i) => i.name)).toEqual(["one"]);
        expect(sessions.prepare([raw("a"), raw("b")])?.items.map((i) => i.name)).toEqual(["a", "b"]);
        expect(sessions.prepare(null)).toBeNull();
        expect(sessions.prepare(undefined)).toBeNull();
        expect(sessions.prepare([])).toBeNull();
        expect(sessions.prepare([{ name: 1 }])).toBeNull();
    });

    it("serializes the fields, without an empty detail or empty tags", () => {
        const sessions = new CallHierarchySessions();
        const [bare] = sessions.prepare(raw("bare"))?.items ?? [];
        expect(bare).toEqual({
            itemId: bare.itemId,
            name: "bare",
            kind: 11,
            uri: "file:///a.ts",
            range: RANGE,
            selectionRange: RANGE,
        });
        const [full] = sessions.prepare(raw("full", { detail: "d", tags: [1, "x"], kind: "bad" }))?.items ?? [];
        expect(full.detail).toBe("d");
        expect(full.tags).toEqual([1]);
        expect(full.kind).toBe(0);
    });

    it("drops an item with a broken shape, not the answer", () => {
        const sessions = new CallHierarchySessions();
        for (const broken of [
            "text",
            raw("no uri", { uri: null }),
            raw("no range", { range: null }),
            raw("no selection", { selectionRange: null }),
        ]) {
            expect(sessions.prepare([broken, raw("kept")])?.items.map((i) => i.name)).toEqual(["kept"]);
        }
    });

    it("gives back the provider's own object by its id, also for items from a later answer", () => {
        const sessions = new CallHierarchySessions();
        const root = raw("root");
        const prepared = sessions.prepare(root);
        if (prepared === null) throw new Error("no session");
        const { sessionId, items } = prepared;
        expect(sessions.item(sessionId, items[0].itemId)).toEqual({ sessionId, item: root });
        expect(sessions.item(sessionId, items[0].itemId).item).toBe(root);

        const caller = raw("caller");
        const [call] = sessions.incomingCalls(sessionId, [{ from: caller, fromRanges: [RANGE, "bad"] }]);
        expect(call.fromRanges).toEqual([RANGE]);
        expect(sessions.item(sessionId, call.from.itemId).item).toBe(caller);

        const callee = raw("callee");
        const [out] = sessions.outgoingCalls(sessionId, [{ to: callee, fromRanges: "bad" }, { to: null }, null]);
        expect(out.fromRanges).toEqual([]);
        expect(sessions.item(sessionId, out.to.itemId).item).toBe(callee);
        expect(sessions.outgoingCalls(sessionId, null)).toEqual([]);
    });

    it("a released session loses its items: asking is an error, a late answer is empty", () => {
        const sessions = new CallHierarchySessions();
        const first = sessions.prepare(raw("first"));
        const second = sessions.prepare(raw("second"));
        if (first === null || second === null) throw new Error("no session");
        expect(second.sessionId).not.toBe(first.sessionId);

        sessions.release(first.sessionId);
        sessions.release(undefined);
        expect(() => sessions.item(first.sessionId, first.items[0].itemId)).toThrow("missing call hierarchy item");
        expect(sessions.incomingCalls(first.sessionId, [{ from: raw("late"), fromRanges: [] }])).toEqual([]);
        expect(sessions.item(second.sessionId, second.items[0].itemId).sessionId).toBe(second.sessionId);
        expect(() => sessions.item(undefined, 1)).toThrow("missing call hierarchy item");
        expect(() => sessions.item(second.sessionId, undefined)).toThrow("missing call hierarchy item");
        expect(() => sessions.item(second.sessionId, 999)).toThrow("missing call hierarchy item");
    });
});
