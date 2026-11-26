import { describe, expect, it } from "vitest";

import { TypeHierarchySessions } from "./extHostTypeHierarchy.ts";

const RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

function raw(name: string, extra: object = {}): object {
    return { name, kind: 10, detail: "", uri: "file:///a.ts", range: RANGE, selectionRange: RANGE, ...extra };
}

function session(sessions: TypeHierarchySessions, root: object) {
    const prepared = sessions.prepare(root);
    if (prepared === null) throw new Error("no session");
    return prepared;
}

describe("TypeHierarchySessions", () => {
    it("prepare keeps the provider's own object; the tags reach the wire", () => {
        const sessions = new TypeHierarchySessions();
        const root = raw("Shape", { tags: [1] });
        const { sessionId, items } = session(sessions, root);
        expect(items[0].tags).toEqual([1]);
        expect(sessions.item(sessionId, items[0].itemId)).toEqual({ sessionId, item: root });
        expect(sessions.item(sessionId, items[0].itemId).item).toBe(root);
    });

    it("types of a later answer are remembered too, a broken one costs itself, not the answer", () => {
        const sessions = new TypeHierarchySessions();
        const { sessionId } = session(sessions, raw("Shape"));
        const circle = raw("Circle");
        const types = sessions.types(sessionId, ["text", null, raw("broken", { name: 1 }), circle]);
        expect(types.map((type) => type.name)).toEqual(["Circle"]);
        expect(sessions.item(sessionId, types[0].itemId).item).toBe(circle);
    });

    it("an answer that is not an array has no types", () => {
        const sessions = new TypeHierarchySessions();
        const { sessionId } = session(sessions, raw("Shape"));
        expect(sessions.types(sessionId, null)).toEqual([]);
        expect(sessions.types(sessionId, raw("single"))).toEqual([]);
    });

    it("a released session loses its items: asking is an error, a late answer is empty", () => {
        const sessions = new TypeHierarchySessions();
        const { sessionId, items } = session(sessions, raw("Shape"));
        sessions.release(sessionId);
        expect(() => sessions.item(sessionId, items[0].itemId)).toThrow("missing type hierarchy item");
        expect(sessions.types(sessionId, [raw("late")])).toEqual([]);
    });
});
