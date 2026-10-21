import { describe, expect, it } from "vitest";

import {
    extensionFriendlyName,
    extensionKey,
    findDependencyLoop,
    isBuiltinVSCodeExtension,
    readExtensionDependencies,
} from "./extensionDependencies.ts";

describe("readExtensionDependencies", () => {
    it("returns ids as declared, deduplicated case-insensitively", () => {
        expect(
            readExtensionDependencies({ extensionDependencies: ["Redhat.Java", "a.b", "redhat.java", "A.B"] }),
        ).toEqual(["Redhat.Java", "a.b"]);
    });

    it("manifest garbage is not a dependency", () => {
        expect(readExtensionDependencies({})).toEqual([]);
        expect(readExtensionDependencies({ extensionDependencies: "redhat.java" })).toEqual([]);
        expect(readExtensionDependencies({ extensionDependencies: [42, "", null, "a.b"] })).toEqual(["a.b"]);
    });
});

describe("extensionFriendlyName", () => {
    it("manifest displayName; empty or non-string falls back to the id", () => {
        expect(extensionFriendlyName("a.b", { displayName: "Bazel Java" })).toBe("Bazel Java");
        expect(extensionFriendlyName("a.b", { displayName: "" })).toBe("a.b");
        expect(extensionFriendlyName("a.b", { displayName: 42 })).toBe("a.b");
        expect(extensionFriendlyName("a.b", {})).toBe("a.b");
    });
});

describe("isBuiltinVSCodeExtension", () => {
    it("publisher vscode, case-insensitive; others are not", () => {
        expect(isBuiltinVSCodeExtension("vscode.git")).toBe(true);
        expect(isBuiltinVSCodeExtension("VSCode.Git")).toBe(true);
        expect(isBuiltinVSCodeExtension("diode.git")).toBe(false);
        expect(isBuiltinVSCodeExtension("myvscode.git")).toBe(false);
    });
});

describe("extensionKey", () => {
    it("the id is case-insensitive", () => {
        expect(extensionKey("Redhat.Java")).toBe("redhat.java");
    });
});

describe("findDependencyLoop", () => {
    const graph = (edges: Record<string, readonly string[]>) => (key: string) => edges[key];

    it("no dependencies, no loop", () => {
        expect(findDependencyLoop("a", graph({ a: [] }))).toBeNull();
        expect(findDependencyLoop("a", graph({}))).toBeNull();
    });

    it("a chain without a way back is not a loop (a diamond neither)", () => {
        expect(findDependencyLoop("a", graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] }))).toBeNull();
    });

    it("a loop through the start extension is reported as a chain from it back to it, case as declared", () => {
        expect(findDependencyLoop("A", graph({ a: ["B"], b: ["c"], c: ["a"] }))).toEqual(["A", "B", "c", "a"]);
    });

    it("a loop through the second dependency is found even if the first is clean", () => {
        expect(findDependencyLoop("a", graph({ a: ["b", "c"], b: [], c: ["a"] }))).toEqual(["a", "c", "a"]);
    });

    it("a self-dependency is a loop", () => {
        expect(findDependencyLoop("a", graph({ a: ["a"] }))).toEqual(["a", "a"]);
    });

    it("a foreign loop without the start extension neither interferes nor makes the walk loop forever", () => {
        expect(findDependencyLoop("a", graph({ a: ["b"], b: ["c"], c: ["b"] }))).toBeNull();
    });

    it("an unknown extension on the path does not continue the loop", () => {
        expect(findDependencyLoop("a", graph({ a: ["x"] }))).toBeNull();
    });
});
