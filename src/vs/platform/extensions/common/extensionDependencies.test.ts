import { describe, expect, it } from "vitest";

import {
    extensionFriendlyName,
    extensionKey,
    findDependencyLoop,
    readExtensionDependencies,
} from "./extensionDependencies.ts";

describe("readExtensionDependencies", () => {
    it("отдаёт id как объявлены, без дублей по ключу без учёта регистра", () => {
        expect(
            readExtensionDependencies({ extensionDependencies: ["Redhat.Java", "a.b", "redhat.java", "A.B"] }),
        ).toEqual(["Redhat.Java", "a.b"]);
    });

    it("мусор манифеста — не зависимость", () => {
        expect(readExtensionDependencies({})).toEqual([]);
        expect(readExtensionDependencies({ extensionDependencies: "redhat.java" })).toEqual([]);
        expect(readExtensionDependencies({ extensionDependencies: [42, "", null, "a.b"] })).toEqual(["a.b"]);
    });
});

describe("extensionFriendlyName", () => {
    it("displayName манифеста, а пустой или не строка — id", () => {
        expect(extensionFriendlyName("a.b", { displayName: "Bazel Java" })).toBe("Bazel Java");
        expect(extensionFriendlyName("a.b", { displayName: "" })).toBe("a.b");
        expect(extensionFriendlyName("a.b", { displayName: 42 })).toBe("a.b");
        expect(extensionFriendlyName("a.b", {})).toBe("a.b");
    });
});

describe("extensionKey", () => {
    it("регистр id не важен", () => {
        expect(extensionKey("Redhat.Java")).toBe("redhat.java");
    });
});

describe("findDependencyLoop", () => {
    const graph = (edges: Record<string, readonly string[]>) => (key: string) => edges[key];

    it("нет зависимостей — нет цикла", () => {
        expect(findDependencyLoop("a", graph({ a: [] }))).toBeNull();
        expect(findDependencyLoop("a", graph({}))).toBeNull();
    });

    it("цепочка без возврата — не цикл (ромб тоже)", () => {
        expect(findDependencyLoop("a", graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] }))).toBeNull();
    });

    it("цикл через стартовое — цепочкой от него к нему, с регистром как объявлено", () => {
        expect(findDependencyLoop("A", graph({ a: ["B"], b: ["c"], c: ["a"] }))).toEqual(["A", "B", "c", "a"]);
    });

    it("цикл через вторую зависимость находится, хоть первая и чиста", () => {
        expect(findDependencyLoop("a", graph({ a: ["b", "c"], b: [], c: ["a"] }))).toEqual(["a", "c", "a"]);
    });

    it("самозависимость — цикл", () => {
        expect(findDependencyLoop("a", graph({ a: ["a"] }))).toEqual(["a", "a"]);
    });

    it("чужой цикл, в который стартовое не входит, не мешает и не зацикливает обход", () => {
        expect(findDependencyLoop("a", graph({ a: ["b"], b: ["c"], c: ["b"] }))).toBeNull();
    });

    it("неизвестное по пути цикл не продолжает", () => {
        expect(findDependencyLoop("a", graph({ a: ["x"] }))).toBeNull();
    });
});
