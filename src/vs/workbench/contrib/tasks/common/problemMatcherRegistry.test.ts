import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";

import { getBuiltinProblemMatcher, type IProblemMatcher, type IProblemPattern } from "./problemMatcher.ts";
import { type IContributingExtension, ProblemMatcherRegistry } from "./problemMatcherRegistry.ts";

// Upstream's `problemPatternExtPoint`/`problemMatchersExtPoint` handlers: manifests' contributions in the
// registry, with upstream's messages for broken ones.

function builtin(name: string): IContributingExtension {
    const path = resolve(import.meta.dirname, "../../../../../../extensions", name, "package.json");
    return { id: `vscode.${name}`, manifest: JSON.parse(readFileSync(path, "utf8")) as IExtensionManifest };
}

function synthetic(id: string, contributes: Readonly<Record<string, unknown>>): IContributingExtension {
    return { id, manifest: { name: id, publisher: "test", version: "1.0.0", engines: { vscode: "*" }, contributes } };
}

function registryOf(...extensions: IContributingExtension[]) {
    const registry = new ProblemMatcherRegistry();
    const reported: string[] = [];
    registry.registerExtensions(extensions, (extension, message) => reported.push(`${extension.id}: ${message}`));
    return { registry, reported };
}

function single(pattern: IProblemPattern | readonly IProblemPattern[] | undefined): IProblemPattern {
    if (pattern === undefined || Array.isArray(pattern)) throw new Error("not a single pattern");
    return pattern as IProblemPattern;
}

function matcherOf(registry: ProblemMatcherRegistry, name: string): IProblemMatcher {
    const matcher = registry.resolve(name);
    if (matcher === undefined) throw new Error(`no matcher ${name}`);
    return matcher;
}

const NAMED_PATTERN = { name: "p", regexp: "^(.*):(\\d+): (.*)$", file: 1, line: 2, message: 3 };

describe("ProblemMatcherRegistry", () => {
    it("builtin cpp: `$nvcc` resolves with the extension's own `$nvcc-location` pattern", () => {
        const { registry, reported } = registryOf(builtin("cpp"));
        const matcher = matcherOf(registry, "$nvcc");
        expect(matcher).toMatchObject({
            owner: "cuda-cpp",
            applyTo: "allDocuments",
            fileLocation: "relative",
            filePrefix: "${workspaceFolder}",
        });
        expect(matcher.pattern).toBe(registry.getPattern("nvcc-location"));
        expect(single(matcher.pattern).regexp.exec('kernel.cu(12): error: expected a ";"')?.slice(1)).toStrictEqual([
            "kernel.cu",
            "12",
            "error",
            'expected a ";"',
        ]);
        expect(reported).toStrictEqual([]);
    });

    it("builtin less and scss: matchers with inline single and multi-line patterns", () => {
        const { registry, reported } = registryOf(builtin("less"), builtin("scss"));
        expect(matcherOf(registry, "lessc")).toMatchObject({
            owner: "lessc",
            source: "less",
            fileLocation: "absolute",
        });
        const sass = matcherOf(registry, "node-sass").pattern as readonly IProblemPattern[];
        expect(sass).toHaveLength(8);
        expect(sass[0].kind).toBe("location");
        expect(reported).toStrictEqual([]);
    });

    it("diode-lsp-typescript: `$tsc` as upstream's typescript-language-features declares it", () => {
        const { registry, reported } = registryOf(builtin("diode-lsp-typescript"));
        const matcher = matcherOf(registry, "tsc");
        expect(matcher).toMatchObject({
            owner: "typescript",
            source: "ts",
            applyTo: "closedDocuments",
            fileLocation: "relative",
            filePrefix: "${cwd}",
        });
        const { regexp } = single(matcher.pattern);
        expect(regexp.exec("src/a.ts(3,5): error TS2322: Type 'string' is not assignable.")?.slice(1)).toStrictEqual([
            "src/a.ts",
            "3",
            "5",
            "error",
            "2322",
            "Type 'string' is not assignable.",
        ]);
        expect(regexp.exec("src/a.ts:3:5 - error TS2322: Type 'string' is not assignable.")?.slice(1, 4)).toStrictEqual(
            ["src/a.ts", "3", "5"],
        );
        expect(reported).toStrictEqual([]);
    });

    it("built-ins are there without any extension, and the registry is not ready until registration", async () => {
        const registry = new ProblemMatcherRegistry();
        expect(registry.resolve("$msCompile")).toBe(getBuiltinProblemMatcher("msCompile"));
        expect(registry.resolve("msCompile")).toBe(getBuiltinProblemMatcher("msCompile"));
        expect(registry.getPattern("go")).toBe(getBuiltinProblemMatcher("go")?.pattern);
        expect(registry.resolve("$nvcc")).toBeUndefined();
        let ready = false;
        void registry.onReady().then(() => {
            ready = true;
        });
        await Promise.resolve();
        expect(ready).toBe(false);
        registry.registerExtensions([], () => undefined);
        await registry.onReady();
        expect(ready).toBe(true);
    });

    it("an invalid pattern is reported with upstream's texts and skipped; the rest are registered", () => {
        const broken = { name: "broken", regexp: "^(.*$" };
        const { registry, reported } = registryOf(synthetic("test.bad", { problemPatterns: [broken, NAMED_PATTERN] }));
        expect(registry.getPattern("broken")).toBeUndefined();
        expect(registry.getPattern("p")).toBeDefined();
        expect(reported).toStrictEqual([
            "test.bad: Error: The string ^(.*$ is not a valid regular expression.\n",
            "test.bad: Invalid problem pattern. The pattern will be ignored.",
            `test.bad: ${JSON.stringify(broken, undefined, 4)}`,
        ]);
    });

    it("a pattern with a message that still parses is invalid too: every parser message is an error upstream", () => {
        const loopNotLast = {
            name: "multi",
            patterns: [
                { regexp: "^(.*)$", file: 1, loop: true },
                { regexp: "^(\\d+): (.*)$", line: 1, message: 2 },
            ],
        };
        const { registry, reported } = registryOf(synthetic("test.bad", { problemPatterns: [loopNotLast] }));
        expect(registry.getPattern("multi")).toBeUndefined();
        expect(reported[0]).toBe("test.bad: The loop property is only supported on the last line matcher.");
        expect(reported[1]).toBe("test.bad: Invalid problem pattern. The pattern will be ignored.");
    });

    it("a named multi-line pattern is registered without the single pattern defaults", () => {
        const { registry, reported } = registryOf(
            synthetic("test.multi", {
                problemPatterns: [
                    {
                        name: "multi",
                        patterns: [
                            { regexp: "^(.*)$", file: 1 },
                            { regexp: "^(\\d+): (.*)$", line: 1, message: 2, loop: true },
                        ],
                    },
                ],
            }),
        );
        const pattern = registry.getPattern("multi") as readonly IProblemPattern[];
        expect(pattern.map(({ regexp, ...rest }) => [regexp.source, rest])).toStrictEqual([
            ["^(.*)$", { kind: "location", file: 1 }],
            ["^(\\d+): (.*)$", { line: 1, message: 2, loop: true }],
        ]);
        expect(reported).toStrictEqual([]);
    });

    it("a pattern without a regular expression is reported; one without a name is skipped silently", () => {
        const { registry, reported } = registryOf(
            synthetic("test.bad", { problemPatterns: [{ name: "noRegexp", file: 1 }, { regexp: "(" }, "x", null] }),
        );
        expect(registry.getPattern("noRegexp")).toBeUndefined();
        expect(reported.slice(0, 2)).toStrictEqual([
            "test.bad: The problem pattern is missing a regular expression.",
            "test.bad: Invalid problem pattern. The pattern will be ignored.",
        ]);
        expect(reported).toHaveLength(3);
    });

    it("a matcher refers to another extension's pattern: patterns of all extensions come first", () => {
        const { registry, reported } = registryOf(
            synthetic("test.matchers", { problemMatchers: [{ name: "m", owner: "o", pattern: "$p" }] }),
            synthetic("test.patterns", { problemPatterns: [NAMED_PATTERN] }),
        );
        expect(matcherOf(registry, "m").pattern).toBe(registry.getPattern("p"));
        expect(reported).toStrictEqual([]);
    });

    it("`base` of a contributed matcher is a built-in or an earlier contributed one", () => {
        const { registry } = registryOf(
            synthetic("test.a", {
                problemMatchers: [
                    { name: "fromBuiltin", base: "$go", owner: "mine" },
                    { name: "fromContributed", base: "$fromBuiltin", source: "src" },
                ],
            }),
        );
        expect(matcherOf(registry, "fromBuiltin")).toMatchObject({ owner: "mine", source: "go" });
        expect(matcherOf(registry, "fromContributed")).toMatchObject({ owner: "mine", source: "src" });
        expect(matcherOf(registry, "fromContributed").pattern).toBe(getBuiltinProblemMatcher("go")?.pattern);
    });

    it("an invalid matcher is reported and skipped; one without a name is not registered", () => {
        const { registry, reported } = registryOf(
            synthetic("test.bad", {
                problemMatchers: [
                    { name: "unknownPattern", owner: "o", pattern: "$nope" },
                    { owner: "o", pattern: "$go" },
                    { name: "ok", owner: "o", pattern: "$go" },
                    "x",
                ],
            }),
        );
        expect(registry.resolve("unknownPattern")).toBeUndefined();
        expect(registry.resolve("ok")).toBeDefined();
        expect(reported[0]).toBe("test.bad: Error: the pattern with the identifier $nope doesn't exist.");
        expect(reported[1]).toMatch(/^test\.bad: Error: the description can't be converted into a problem matcher:/);
        expect(reported).toHaveLength(2);
    });

    it("a name taken by a built-in or an earlier extension: the last registered wins (upstream's `add`)", () => {
        const { registry } = registryOf(
            synthetic("test.first", {
                problemPatterns: [{ ...NAMED_PATTERN, name: "go" }],
                problemMatchers: [{ name: "go", owner: "first", pattern: "$go" }],
            }),
            synthetic("test.second", { problemMatchers: [{ name: "go", owner: "second", pattern: "$go" }] }),
        );
        expect(single(registry.getPattern("go")).regexp.source).toBe(NAMED_PATTERN.regexp);
        expect(matcherOf(registry, "go").owner).toBe("second");
        expect(matcherOf(registry, "go").pattern).toBe(registry.getPattern("go"));
    });

    it("a contribution that is not an array contributes nothing; an unregistered extension's matchers are gone", () => {
        const { registry, reported } = registryOf(
            synthetic("test.odd", { problemPatterns: NAMED_PATTERN, problemMatchers: { name: "m" } }),
        );
        expect(registry.getPattern("p")).toBeUndefined();
        expect(registry.resolve("m")).toBeUndefined();
        expect(registry.resolve("nvcc")).toBeUndefined();
        expect(reported).toStrictEqual([]);
    });

    it("a named pattern with `regexp` and `patterns` that are not all patterns is a single one, as upstream", () => {
        const { registry, reported } = registryOf(
            synthetic("test.odd", {
                problemPatterns: [{ ...NAMED_PATTERN, patterns: [{ regexp: "x" }, { file: 1 }] }],
            }),
        );
        expect(single(registry.getPattern("p")).regexp.source).toBe(NAMED_PATTERN.regexp);
        expect(reported).toStrictEqual([]);
    });

    it("an invalid matcher does not displace an earlier valid one of the same name", () => {
        const { registry } = registryOf(
            synthetic("test.first", { problemMatchers: [{ name: "m", owner: "first", pattern: "$go" }] }),
            synthetic("test.second", { problemMatchers: [{ name: "m", owner: "second", pattern: "$nope" }] }),
        );
        expect(matcherOf(registry, "m").owner).toBe("first");
    });
});
