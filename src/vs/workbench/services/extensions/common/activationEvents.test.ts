import { describe, expect, it } from "vitest";

import {
    computeActivationEvents,
    hasWorkspaceContainsPatterns,
    IMPLICIT_ACTIVATION_EVENT_GENERATORS,
    NO_WORKSPACE_CONTAINS_PATTERNS,
    readActivationEvents,
    readCommandActivationIds,
    readWorkspaceContainsPatterns,
} from "./activationEvents.ts";

describe("computeActivationEvents", () => {
    it("declared events are returned as is", () => {
        expect(
            computeActivationEvents({ activationEvents: ["onStartupFinished", "onLanguage:java"] }, "pub.ext"),
        ).toEqual(["onStartupFinished", "onLanguage:java"]);
    });

    it("each contributes.commands adds an IMPLICIT onCommand:<id>", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onLanguage:python"],
                    contributes: {
                        commands: [
                            { command: "ruff.restart", title: "Restart Server" },
                            { command: "ruff.showLogs", title: "Show client logs" },
                        ],
                    },
                },
                "pub.ext",
            ),
        ).toEqual(["onLanguage:python", "onCommand:ruff.restart", "onCommand:ruff.showLogs"]);
    });

    it("each contributes.languages adds an IMPLICIT onLanguage:<id>", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { languages: [{ id: "toml" }, { id: "ini" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished", "onLanguage:toml", "onLanguage:ini"]);
    });

    it("each contributes.taskDefinitions adds an IMPLICIT onTaskType:<type>; none without a type or with an empty one", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { taskDefinitions: [{ type: "bazel" }, {}, { type: "" }, { type: "npm" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished", "onTaskType:bazel", "onTaskType:npm"]);
    });

    it("an implicit event does not duplicate one declared by hand", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onCommand:a.b", "onLanguage:x"],
                    contributes: { commands: [{ command: "a.b", title: "A B" }], languages: [{ id: "x" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onCommand:a.b", "onLanguage:x"]);
    });

    it("entries without a string id yield no implicit events", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { commands: [{ title: "No id" } as never], languages: [{} as never] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished"]);
    });

    it("manifest without events — eager * (deviation from upstream for published extensions), plus implicit ones", () => {
        expect(computeActivationEvents({}, "pub.ext")).toEqual(["*"]);
        expect(computeActivationEvents({ activationEvents: [] }, "pub.ext")).toEqual(["*"]);
        expect(
            computeActivationEvents({ contributes: { commands: [{ command: "a.b", title: "A" }] } }, "pub.ext"),
        ).toEqual(["*", "onCommand:a.b"]);
    });

    it("bare onUri becomes onUri:<lowercase id>, with an argument — as is", () => {
        expect(
            computeActivationEvents({ activationEvents: ["onUri", "onUri:other.ext", "onStartupFinished"] }, "Pub.Ext"),
        ).toEqual(["onUri:pub.ext", "onUri:other.ext", "onStartupFinished"]);
    });

    it("generators are listed explicitly — one per contribution point", () => {
        expect(IMPLICIT_ACTIVATION_EVENT_GENERATORS.map((g) => g.point)).toEqual([
            "commands",
            "languages",
            "taskDefinitions",
        ]);
    });
});

describe("readActivationEvents", () => {
    it("returns the registration's computed set as is", () => {
        expect(readActivationEvents({ activationEvents: ["*", "onCommand:a.b"] })).toEqual(["*", "onCommand:a.b"]);
    });

    it("registration without events — empty", () => {
        expect(readActivationEvents({})).toEqual([]);
    });
});

describe("readCommandActivationIds", () => {
    it("ids from onCommand:, without duplicates, in set order", () => {
        expect(
            readCommandActivationIds({
                activationEvents: [
                    "onCommand:_java.templateVariables",
                    "onLanguage:java",
                    "onCommand:x.y",
                    "onCommand:x.y",
                ],
            }),
        ).toEqual(["_java.templateVariables", "x.y"]);
    });

    it("extension without commands yields no ids", () => {
        expect(readCommandActivationIds({ activationEvents: ["onLanguage:java"] })).toEqual([]);
    });

    it("empty id (`onCommand:`) is dropped", () => {
        expect(readCommandActivationIds({ activationEvents: ["onCommand:"] })).toEqual([]);
    });
});

describe("readWorkspaceContainsPatterns", () => {
    it("a pattern without glob characters goes to paths, with them — to globs", () => {
        // Manifest of the stock redhat.java: both semantics of one prefix.
        expect(
            readWorkspaceContainsPatterns({
                activationEvents: [
                    "workspaceContains:pom.xml",
                    "workspaceContains:*/pom.xml",
                    "workspaceContains:.classpath",
                    "workspaceContains:*/.classpath",
                    "onLanguage:java",
                ],
            }),
        ).toEqual({
            paths: ["pom.xml", ".classpath"],
            globs: ["*/pom.xml", "*/.classpath"],
        });
    });

    it("`?` also makes a pattern a glob", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:pom?.xml"] })).toEqual({
            paths: [],
            globs: ["pom?.xml"],
        });
    });

    it("recursive `**/` stays a glob", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:**/pyproject.toml"] })).toEqual({
            paths: [],
            globs: ["**/pyproject.toml"],
        });
    });

    it("an empty pattern is dropped — otherwise it would match any workspace", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:"] })).toEqual({
            paths: [],
            globs: [],
        });
    });

    it("duplicates collapse", () => {
        expect(
            readWorkspaceContainsPatterns({
                activationEvents: ["workspaceContains:pom.xml", "workspaceContains:pom.xml"],
            }),
        ).toEqual({ paths: ["pom.xml"], globs: [] });
    });

    it("extension without workspaceContains yields an empty set", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["onStartupFinished"] })).toEqual({
            paths: [],
            globs: [],
        });
    });

    it("eager default [*] is not read as workspaceContains", () => {
        expect(readWorkspaceContainsPatterns({})).toEqual({ paths: [], globs: [] });
    });

    it("an impostor prefix (`workspaceContainsX:`) is not picked up", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContainsNot:pom.xml"] })).toEqual({
            paths: [],
            globs: [],
        });
    });
});

describe("hasWorkspaceContainsPatterns", () => {
    it("empty set — nothing to count", () => {
        expect(hasWorkspaceContainsPatterns(NO_WORKSPACE_CONTAINS_PATTERNS)).toBe(false);
    });

    it("paths only — something to count", () => {
        expect(hasWorkspaceContainsPatterns({ paths: ["pom.xml"], globs: [] })).toBe(true);
    });

    it("globs only — something to count", () => {
        expect(hasWorkspaceContainsPatterns({ paths: [], globs: ["*/pom.xml"] })).toBe(true);
    });
});
