import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileStatWithChildren } from "../../../../platform/files/common/files.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

import {
    createLineMatcher,
    getBuiltinProblemMatcher,
    getResource,
    type IProblemMatch,
    type IProblemMatcher,
    type IProblemMatcherFiles,
    type IProblemPattern,
    parseProblemMatcher,
    parseProblemPattern,
} from "./problemMatcher.ts";

const NO_FILES: IProblemMatcherFiles = {
    exists: () => Promise.resolve(false),
    resolve: () => Promise.reject(new Error("no file system")),
};

/** Files by path; directories are implied by them. */
function filesOf(...files: string[]): IProblemMatcherFiles {
    const children = (dir: string) => {
        const prefix = dir.endsWith("/") ? dir : `${dir}/`;
        const names = new Map<string, FileType>();
        for (const file of files) {
            if (!file.startsWith(prefix)) continue;
            const [name, ...rest] = file.substring(prefix.length).split("/");
            names.set(name, rest.length > 0 ? FileType.Directory : FileType.File);
        }
        return [...names].map(([name, type]) => ({ name, type, resource: Uri.file(prefix + name) }));
    };
    return {
        exists: (uri) => Promise.resolve(files.includes(uri.fsPath)),
        resolve: (uri) => Promise.resolve({ children: children(uri.fsPath) } as unknown as IFileStatWithChildren),
    };
}

function builtin(name: string): IProblemMatcher {
    const matcher = getBuiltinProblemMatcher(name);
    if (matcher === undefined) throw new Error(`no ${name}`);
    return matcher;
}

interface IFound {
    readonly resource: string;
    readonly severity: MarkerSeverity;
    readonly range: [number, number, number, number];
    readonly message: string;
    readonly code?: string;
    readonly source?: string;
}

async function found(match: IProblemMatch): Promise<IFound> {
    const { marker } = match;
    const { start, end } = marker.range;
    return {
        resource: (await match.resource).fsPath,
        severity: marker.severity,
        range: [start.line, start.character, end.line, end.character],
        message: marker.message,
        ...(marker.code !== undefined ? { code: marker.code } : {}),
        ...(marker.source !== undefined ? { source: marker.source } : {}),
    };
}

/** Lines through one matcher the way the collector feeds it: a buffer of `matchLength`, then `next` while looping. */
async function matchLines(matcher: IProblemMatcher, lines: readonly string[], files = NO_FILES): Promise<IFound[]> {
    const lineMatcher = createLineMatcher(matcher, files);
    const results: IProblemMatch[] = [];
    let buffer: string[] = [];
    let looping = false;
    for (const line of lines) {
        if (looping) {
            const next = lineMatcher.next(line);
            if (next !== null) {
                results.push(next);
                continue;
            }
            looping = false;
            buffer = [];
        }
        buffer = [...buffer, line].slice(-lineMatcher.matchLength);
        if (buffer.length < lineMatcher.matchLength) continue;
        const result = lineMatcher.handle(buffer, 0);
        if (result.match !== null) {
            results.push(result.match);
            looping = result.continue;
            buffer = [];
        }
    }
    return Promise.all(results.map(found));
}

const WHOLE_LINE = 2 ** 31 - 2;

describe("built-in problem matchers (upstream definitions)", () => {
    it("by name with and without $; an unknown one is undefined", () => {
        expect(getBuiltinProblemMatcher("$eslint-stylish")).toBe(getBuiltinProblemMatcher("eslint-stylish"));
        expect(getBuiltinProblemMatcher("$nope")).toBeUndefined();
        expect(getBuiltinProblemMatcher("$tsc")).toBeUndefined();
        expect(
            [
                "msCompile",
                "lessCompile",
                "gulp-tsc",
                "jshint",
                "jshint-stylish",
                "eslint-compact",
                "eslint-stylish",
                "go",
            ].map((name) => {
                const { owner, source, applyTo, fileLocation, filePrefix, severity } = builtin(name);
                return [name, owner, source, applyTo, fileLocation, filePrefix, severity];
            }),
        ).toStrictEqual([
            ["msCompile", "msCompile", "cpp", "allDocuments", "absolute", undefined, undefined],
            ["lessCompile", "lessCompile", "less", "allDocuments", "absolute", undefined, MarkerSeverity.Error],
            ["gulp-tsc", "typescript", "ts", "closedDocuments", "relative", "${workspaceFolder}", undefined],
            ["jshint", "jshint", "jshint", "allDocuments", "absolute", undefined, undefined],
            ["jshint-stylish", "jshint", "jshint", "allDocuments", "absolute", undefined, undefined],
            ["eslint-compact", "eslint", "eslint", "allDocuments", "absolute", "${workspaceFolder}", undefined],
            ["eslint-stylish", "eslint", "eslint", "allDocuments", "absolute", undefined, undefined],
            ["go", "go", "go", "allDocuments", "relative", "${workspaceFolder}", undefined],
        ]);
    });

    it("$msCompile: location, severity, code; `fatal error` falls back to error", async () => {
        expect(
            await matchLines(builtin("$msCompile"), [
                "/ws/src/a.ts(3,5): error TS1005: ';' expected.",
                "  2>/ws/b.cpp(10,1,10,4) : warning C4996: deprecated",
                "/ws/c.cpp : fatal error C1083: cannot open",
                "noise",
            ]),
        ).toStrictEqual([
            {
                resource: "/ws/src/a.ts",
                severity: MarkerSeverity.Error,
                range: [2, 4, 2, 4],
                message: "';' expected.",
                code: "TS1005",
                source: "cpp",
            },
            {
                resource: "/ws/b.cpp",
                severity: MarkerSeverity.Warning,
                range: [9, 0, 9, 3],
                message: "deprecated",
                code: "C4996",
                source: "cpp",
            },
            {
                resource: "/ws/c.cpp",
                severity: MarkerSeverity.Error,
                range: [0, 0, 0, 0],
                message: "cannot open",
                code: "C1083",
                source: "cpp",
            },
        ]);
    });

    it("$lessCompile, $gulp-tsc (relative to the prefix), $jshint, $go", async () => {
        expect(
            await matchLines(builtin("lessCompile"), ["Unrecognised input in file /ws/s.less line no. 7"]),
        ).toStrictEqual([
            {
                resource: "/ws/s.less",
                severity: MarkerSeverity.Error,
                range: [6, 0, 6, WHOLE_LINE],
                message: "Unrecognised input",
                source: "less",
            },
        ]);
        const gulp = { ...builtin("gulp-tsc"), filePrefix: "/ws" };
        expect(await matchLines(gulp, ["src/a.ts(4,2): 2304 Cannot find name 'x'."])).toStrictEqual([
            {
                resource: "/ws/src/a.ts",
                severity: MarkerSeverity.Error,
                range: [3, 1, 3, 1],
                message: "Cannot find name 'x'.",
                code: "2304",
                source: "ts",
            },
        ]);
        expect(
            await matchLines(builtin("jshint"), ["/ws/a.js: line 3, col 9, Missing semicolon. (W033)"]),
        ).toStrictEqual([
            {
                resource: "/ws/a.js",
                severity: MarkerSeverity.Warning,
                range: [2, 8, 2, 8],
                message: "Missing semicolon.",
                code: "033",
                source: "jshint",
            },
        ]);
        const go = { ...builtin("go"), filePrefix: "/ws" };
        expect(await matchLines(go, ["# pkg: main.go:12:3: undefined: foo", "util.go:4: bad"])).toStrictEqual([
            {
                resource: "/ws/main.go",
                severity: MarkerSeverity.Error,
                range: [11, 2, 11, 2],
                message: "undefined: foo",
                source: "go",
            },
            {
                resource: "/ws/util.go",
                severity: MarkerSeverity.Error,
                range: [3, 0, 3, WHOLE_LINE],
                message: "bad",
                source: "go",
            },
        ]);
    });

    it("$eslint-compact: Error/Warning/Info by name", async () => {
        expect(
            await matchLines(builtin("$eslint-compact"), [
                "/ws/app.js: line 1, col 7, Error - 'unused' is assigned a value but never used. (no-unused-vars)",
                "/ws/app.js: line 2, col 1, Warning - Unexpected console statement. (no-console)",
            ]),
        ).toStrictEqual([
            {
                resource: "/ws/app.js",
                severity: MarkerSeverity.Error,
                range: [0, 6, 0, 6],
                message: "'unused' is assigned a value but never used.",
                code: "no-unused-vars",
                source: "eslint",
            },
            {
                resource: "/ws/app.js",
                severity: MarkerSeverity.Warning,
                range: [1, 0, 1, 0],
                message: "Unexpected console statement.",
                code: "no-console",
                source: "eslint",
            },
        ]);
    });

    it("$eslint-stylish: a file line, then a looping problem line per problem", async () => {
        expect(
            await matchLines(builtin("$eslint-stylish"), [
                "/ws/app.js",
                "  1:7   error  'unused' is assigned a value but never used  no-unused-vars",
                "  1:19  error  Unnecessary semicolon                         no-extra-semi",
                "",
                "/ws/lib/b.js",
                "  3:1  warning  Unexpected console statement  no-console",
                "✖ 3 problems (2 errors, 1 warning)",
            ]),
        ).toStrictEqual([
            {
                resource: "/ws/app.js",
                severity: MarkerSeverity.Error,
                range: [0, 6, 0, 6],
                message: "'unused' is assigned a value but never used",
                code: "no-unused-vars",
                source: "eslint",
            },
            {
                resource: "/ws/app.js",
                severity: MarkerSeverity.Error,
                range: [0, 18, 0, 18],
                message: "Unnecessary semicolon",
                code: "no-extra-semi",
                source: "eslint",
            },
            {
                resource: "/ws/lib/b.js",
                severity: MarkerSeverity.Warning,
                range: [2, 0, 2, 0],
                message: "Unexpected console statement",
                code: "no-console",
                source: "eslint",
            },
        ]);
    });

    it("$jshint-stylish: E/W/I letters are severities", async () => {
        expect(
            await matchLines(builtin("jshint-stylish"), [
                "/ws/a.js",
                "  line 1  col 2  Bad thing. (E001)",
                "  line 2  col 3  Odd thing. (W002)",
                "  line 3  col 4  Note. (I003)",
            ]),
        ).toStrictEqual([
            {
                resource: "/ws/a.js",
                severity: MarkerSeverity.Error,
                range: [0, 1, 0, 1],
                message: "Bad thing.",
                code: "001",
                source: "jshint",
            },
            {
                resource: "/ws/a.js",
                severity: MarkerSeverity.Warning,
                range: [1, 2, 1, 2],
                message: "Odd thing.",
                code: "002",
                source: "jshint",
            },
            {
                resource: "/ws/a.js",
                severity: MarkerSeverity.Info,
                range: [2, 3, 2, 3],
                message: "Note.",
                code: "003",
                source: "jshint",
            },
        ]);
    });
});

function parse(json: Record<string, unknown>): { matcher: IProblemMatcher | undefined; problems: string[] } {
    const problems: string[] = [];
    const matcher = parseProblemMatcher(json, (message) => problems.push(message));
    return { matcher, problems };
}

describe("parseProblemMatcher — an inline problemMatcher of tasks.json", () => {
    it("defaults: relative to ${workspaceFolder}, all documents, pattern groups file 1, line 2, column 3, message 0", async () => {
        const { matcher, problems } = parse({ owner: "mine", pattern: { regexp: "^(\\S+):(\\d+):(\\d+) (.*)$" } });
        expect(problems).toStrictEqual([]);
        expect(matcher).toMatchObject({
            owner: "mine",
            applyTo: "allDocuments",
            fileLocation: "relative",
            filePrefix: "${workspaceFolder}",
            pattern: { kind: "location", file: 1, line: 2, character: 3, message: 0 },
        });
        expect(matcher?.source).toBeUndefined();
        expect(matcher?.severity).toBeUndefined();
        expect(await matchLines({ ...matcher!, filePrefix: "/ws" }, ["a.c:2:3 boom"])).toStrictEqual([
            { resource: "/ws/a.c", severity: MarkerSeverity.Error, range: [1, 2, 1, 2], message: "a.c:2:3 boom" },
        ]);
    });

    it("all properties: source, severity, applyTo, fileLocation, pattern groups with kind file", async () => {
        const { matcher, problems } = parse({
            owner: "o",
            source: "lint",
            severity: "Warning",
            applyTo: "OpenDocuments",
            fileLocation: "absolute",
            pattern: {
                regexp: "^(\\S+) (\\w+) (.*)$",
                kind: "file",
                file: 1,
                code: 2,
                message: 3,
            },
        });
        expect(problems).toStrictEqual([]);
        expect(matcher).toMatchObject({ source: "lint", severity: MarkerSeverity.Warning, applyTo: "openDocuments" });
        expect(await matchLines(matcher!, ["/ws/x.md E12 broken link"])).toStrictEqual([
            {
                resource: "/ws/x.md",
                severity: MarkerSeverity.Warning,
                range: [0, 0, 0, 0],
                message: "broken link",
                code: "E12",
                source: "lint",
            },
        ]);
    });

    it("severity group wins over the matcher severity; hint/note are info, unknown falls back", async () => {
        const { matcher } = parse({
            owner: "o",
            severity: "info",
            fileLocation: "absolute",
            pattern: { regexp: "^(\\S+):(\\d+) (\\w+): (.*)$", file: 1, line: 2, severity: 3, message: 4 },
        });
        const severities = (
            await matchLines(matcher!, ["/a:1 error: x", "/a:1 WARN: x", "/a:1 hint: x", "/a:1 Note: x", "/a:1 odd: x"])
        ).map((f) => f.severity);
        expect(severities).toStrictEqual([
            MarkerSeverity.Error,
            MarkerSeverity.Warning,
            MarkerSeverity.Info,
            MarkerSeverity.Info,
            MarkerSeverity.Info,
        ]);
    });

    it("location group: line; line,column; four numbers", async () => {
        const { matcher } = parse({
            owner: "o",
            fileLocation: ["absolute"],
            pattern: { regexp: "^(\\S+)\\(([\\d,]+)\\): (.*)$", file: 1, location: 2, message: 3 },
        });
        expect(
            (await matchLines(matcher!, ["/a(5): m", "/a(5,6): m", "/a(5,6,7,8): m"])).map((f) => f.range),
        ).toStrictEqual([
            [4, 0, 4, WHOLE_LINE],
            [4, 5, 4, 5],
            [4, 5, 6, 7],
        ]);
    });

    it("endLine/endColumn groups; an end column without an end line ends on the start line", async () => {
        const { matcher } = parse({
            owner: "o",
            fileLocation: "absolute",
            pattern: {
                regexp: "^(\\S+) (\\d+):(\\d+)-(\\d*):(\\d+) (.*)$",
                file: 1,
                line: 2,
                column: 3,
                endLine: 4,
                endColumn: 5,
                message: 6,
            },
        });
        expect((await matchLines(matcher!, ["/a 2:3-4:5 m", "/a 2:3-:9 m"])).map((f) => f.range)).toStrictEqual([
            [1, 2, 3, 4],
            [1, 2, 1, 8],
        ]);
    });

    it("multi-line pattern with loop: the first lines' captures are shared, a multi-line message is joined", async () => {
        const { matcher, problems } = parse({
            owner: "multi",
            fileLocation: "absolute",
            pattern: [
                { regexp: "^FILE (.*)$", file: 1 },
                { regexp: "^  at (\\d+):(\\d+) (.*)$", line: 1, column: 2, message: 3, loop: true },
            ],
        });
        expect(problems).toStrictEqual([]);
        expect(
            await matchLines(matcher!, [
                "FILE /ws/a b/ü.ts",
                "  at 1:2 first",
                "  at 3:4 second",
                "done",
                "  at 5:6 stray",
            ]),
        ).toStrictEqual([
            { resource: "/ws/a b/ü.ts", severity: MarkerSeverity.Error, range: [0, 1, 0, 1], message: "first" },
            { resource: "/ws/a b/ü.ts", severity: MarkerSeverity.Error, range: [2, 3, 2, 3], message: "second" },
        ]);
        const joined = parse({
            owner: "o",
            fileLocation: "absolute",
            pattern: [
                { regexp: "^(\\S+):(\\d+) (.*)$", file: 1, line: 2, message: 3 },
                { regexp: "^ +(.*)$", message: 1 },
            ],
        });
        expect((await matchLines(joined.matcher!, ["/a:1 head", "   tail"])).map((f) => f.message)).toStrictEqual([
            "head\ntail",
        ]);
    });

    it("a named built-in pattern", async () => {
        const { matcher, problems } = parse({ owner: "o", fileLocation: "absolute", pattern: "$eslint-compact" });
        expect(problems).toStrictEqual([]);
        expect(await matchLines(matcher!, ["/a.js: line 1, col 2, Info - Hello. (r)"])).toStrictEqual([
            { resource: "/a.js", severity: MarkerSeverity.Info, range: [0, 1, 0, 1], message: "Hello.", code: "r" },
        ]);
    });

    it("base: the built-in with the description's properties on top", () => {
        const base = builtin("eslint-stylish");
        const plain = parse({ base: "$eslint-stylish" });
        expect(plain.problems).toStrictEqual([]);
        expect(plain.matcher).toStrictEqual(base);
        const custom = parse({
            base: "$eslint-stylish",
            owner: "mine",
            source: "src",
            fileLocation: ["relative", "${cwd}"],
            severity: "warning",
            applyTo: "closedDocuments",
            pattern: { regexp: "^(.*)$", kind: "file" },
        });
        expect(custom.problems).toStrictEqual([]);
        expect(custom.matcher).toMatchObject({
            owner: "mine",
            source: "src",
            fileLocation: "relative",
            filePrefix: "${cwd}",
            severity: MarkerSeverity.Warning,
            applyTo: "closedDocuments",
            pattern: { kind: "file", file: 1, message: 0 },
        });
    });

    it("fileLocation forms: autoDetect and search get the folder; a bad one is an error", () => {
        const pattern = { regexp: "^(.*):(\\d+) (.*)$", message: 3 };
        expect(parse({ owner: "o", pattern, fileLocation: "autoDetect" }).matcher).toMatchObject({
            fileLocation: "autoDetect",
            filePrefix: "${workspaceFolder}",
        });
        expect(parse({ owner: "o", pattern, fileLocation: ["autodetect", "/base"] }).matcher).toMatchObject({
            fileLocation: "autoDetect",
            filePrefix: "/base",
        });
        expect(parse({ owner: "o", pattern, fileLocation: "search" }).matcher).toMatchObject({
            fileLocation: "search",
            filePrefix: { include: ["${workspaceFolder}"] },
        });
        expect(
            parse({ owner: "o", pattern, fileLocation: ["search", { include: "/a", exclude: ["/a/x"], other: 1 }] })
                .matcher,
        ).toMatchObject({ fileLocation: "search", filePrefix: { include: "/a", exclude: ["/a/x"] } });
        expect(parse({ owner: "o", pattern, fileLocation: ["search", 5] }).matcher).toMatchObject({
            fileLocation: "search",
            filePrefix: { include: ["${workspaceFolder}"] },
        });
        // A string array other than ["absolute"] or [relative|autoDetect, base] has no file location: ["search"] too.
        for (const fileLocation of [
            "nowhere",
            [],
            ["search"],
            ["relative"],
            ["relative", ""],
            ["absolute", "/x"],
            [1],
        ]) {
            const { matcher, problems } = parse({ owner: "o", pattern, fileLocation });
            expect(matcher).toBeUndefined();
            expect(problems[0]).toMatch(/^Error: the description can't be converted into a problem matcher:\n\{/);
        }
    });

    it("without an owner gets a generated one; an empty owner is an error", () => {
        const pattern = { regexp: "^(.*):(\\d+) (.*)$", message: 3 };
        const a = parse({ pattern }).matcher;
        const b = parse({ pattern }).matcher;
        expect(a?.owner).toMatch(/^[0-9a-f-]{36}$/);
        expect(a?.owner).not.toBe(b?.owner);
        const empty = parse({ owner: "", pattern });
        expect(empty.matcher).toBeUndefined();
        expect(empty.problems).toStrictEqual([
            `Error: the description doesn't define an owner:\n${JSON.stringify({ owner: "", pattern }, null, 4)}\n`,
        ]);
    });

    it("unknown severity is info and error is used", () => {
        const { matcher, problems } = parse({
            owner: "o",
            severity: "loud",
            pattern: { regexp: "(.*)", kind: "file" },
        });
        expect(problems).toStrictEqual(["Info: unknown severity loud. Valid values are error, warning and info.\n"]);
        expect(matcher?.severity).toBe(MarkerSeverity.Error);
    });

    it("broken patterns are reported in upstream's words", () => {
        const errors = (pattern: unknown): string[] => parse({ owner: "o", pattern }).problems;
        const cannot = (json: Record<string, unknown>): string =>
            `Error: the description can't be converted into a problem matcher:\n${JSON.stringify(json, null, 4)}\n`;
        expect(errors({ regexp: "(" })).toStrictEqual([
            "Error: The string ( is not a valid regular expression.\n",
            cannot({ owner: "o", pattern: { regexp: "(" } }),
        ]);
        expect(errors({ file: 1 })[0]).toBe("The problem pattern is missing a regular expression.");
        expect(errors({ regexp: "x", file: 1, message: 0, line: 2, kind: "location", loop: true })).toStrictEqual([]);
        expect(errors({ regexp: "x", location: 0 })).toStrictEqual([]);
        expect(errors([{ regexp: "x", line: 1, message: 0 }])[0]).toBe(
            "The problem pattern is invalid. It must have at least have a file and a message.",
        );
        expect(errors([{ regexp: "x", file: 1, message: 0 }])[0]).toBe(
            'The problem pattern is invalid. It must either have kind: "file" or have a line or location match group.',
        );
        expect(errors([{ regexp: "x", file: 1, message: 0, kind: "file" }])).toStrictEqual([]);
        expect(
            errors([
                { regexp: "x", file: 1, loop: true },
                { regexp: "y", line: 1, message: 0, kind: "file" },
            ]),
        ).toStrictEqual([
            "The loop property is only supported on the last line matcher.",
            "The problem pattern is invalid. The kind property must be provided only in the first element",
        ]);
        expect(errors([])[0]).toBe("The problem pattern is invalid. It must contain at least one pattern.");
        expect(errors([{ regexp: "x" }, { regexp: "(" }])[0]).toBe(
            "Error: The string ( is not a valid regular expression.\n",
        );
        expect(errors([{ regexp: "x" }, { noRegexp: 1 }])[0]).toBe(
            "The problem pattern is missing a regular expression.",
        );
        expect(errors("$nope")[0]).toBe("Error: the pattern with the identifier $nope doesn't exist.");
        expect(errors("$")[0]).toBe("Error: the pattern property $ is not a valid pattern variable name.");
        expect(errors("eslint")[0]).toBe("Error: the pattern property eslint is not a valid pattern variable name.");
        expect(parse({ owner: "o" }).problems).toStrictEqual([cannot({ owner: "o" })]);
    });

    it("an unknown base or one without $ gives no matcher", () => {
        expect(parse({ base: "$nope" }).matcher).toBeUndefined();
        expect(parse({ base: "eslint-stylish" }).matcher).toBeUndefined();
        expect(parse({ base: "$" }).matcher).toBeUndefined();
    });

    it("parseProblemPattern: a single pattern defaults to kind location", () => {
        expect(parseProblemPattern({ regexp: "x", location: 2, file: 1, message: 3 }, () => undefined)).toMatchObject({
            kind: "location",
            location: 2,
        });
        expect(
            parseProblemPattern({ regexp: "x", kind: "nonsense", line: 1, file: 1, message: 0 }, () => undefined),
        ).toMatchObject({ kind: "location" });
    });
});

describe("line matchers — edges", () => {
    const simple = (overrides: Partial<IProblemMatcher> = {}): IProblemMatcher => ({
        owner: "o",
        applyTo: "allDocuments",
        fileLocation: "absolute",
        pattern: {
            regexp: /^([^:]*):(\d*):(\d*) ?(.*)$/,
            kind: "location",
            file: 1,
            line: 2,
            character: 3,
            message: 4,
        },
        ...overrides,
    });

    it("no file, no message or no line is no match; a location pattern without line becomes a file problem", async () => {
        expect(await matchLines(simple(), [":1:2 m", "/a:1:2 ", "/a:: m", "nothing"])).toStrictEqual([
            { resource: "/a", severity: MarkerSeverity.Error, range: [0, 0, 0, 0], message: "m" },
        ]);
    });

    it("a multi-line pattern whose later line does not match is no match", async () => {
        const matcher = simple({
            pattern: [
                { regexp: /^F (.*)$/, kind: "location", file: 1 },
                { regexp: /^L (\d+) (.*)$/, line: 1, message: 2 },
            ],
        });
        expect(await matchLines(matcher, ["F /a", "nope", "F /b", "L 2 m", "L 3 n"])).toStrictEqual([
            { resource: "/b", severity: MarkerSeverity.Error, range: [1, 0, 1, WHOLE_LINE], message: "m" },
        ]);
    });

    it("a multi-line matcher reads its lines from the start index; kind file comes from the first pattern", async () => {
        const lineMatcher = createLineMatcher(
            simple({
                pattern: [
                    { regexp: /^F (.*)$/, kind: "file", file: 1 },
                    { regexp: /^M (.*)$/, message: 1 },
                ],
            }),
            NO_FILES,
        );
        const match = lineMatcher.handle(["noise", "F /a", "M whole file"], 1).match;
        expect(match === null ? null : await found(match)).toStrictEqual({
            resource: "/a",
            severity: MarkerSeverity.Error,
            range: [0, 0, 0, 0],
            message: "whole file",
        });
    });

    it("an invalid pattern gives no matcher", () => {
        expect(parse({ owner: "o", pattern: [{ regexp: "x", line: 1, message: 0 }] }).matcher).toBeUndefined();
        expect(parse({ owner: "o", pattern: [{ regexp: "x", file: 1, message: 0 }] }).matcher).toBeUndefined();
    });

    it("the looping pattern's captures don't leak into the next loop line", async () => {
        const matcher = simple({
            pattern: [
                { regexp: /^F (.*)$/, kind: "location", file: 1 },
                { regexp: /^L (\d+)(?: (\w+))? (.*)$/, line: 1, code: 2, message: 3, loop: true },
            ],
        });
        const result = await matchLines(matcher, ["F /a", "L 1 C1 one", "L 2 two"]);
        expect(result.map((f) => f.code)).toStrictEqual(["C1", undefined]);
    });
});

describe("getResource — file names to resources", () => {
    const matcher = (overrides: Partial<IProblemMatcher>): IProblemMatcher => ({
        owner: "o",
        applyTo: "allDocuments",
        fileLocation: "absolute",
        pattern: { regexp: /x/ },
        ...overrides,
    });

    it("absolute and relative are normalized; a path without a leading slash gets one", async () => {
        expect((await getResource("/ws/./a/../b.ts", matcher({}), NO_FILES)).toString()).toBe("file:///ws/b.ts");
        expect((await getResource("rel.ts", matcher({}), NO_FILES)).toString()).toBe("file:///rel.ts");
        const relative = matcher({ fileLocation: "relative", filePrefix: "/ws/sub" });
        expect((await getResource("../x y/ü.ts", relative, NO_FILES)).fsPath).toBe("/ws/x y/ü.ts");
    });

    it("relative without a prefix is not actionable", async () => {
        await expect(getResource("a.ts", matcher({ fileLocation: "relative" }), NO_FILES)).rejects.toThrow(
            "FileLocationKind is not actionable",
        );
    });

    it("autoDetect: relative if that file exists, otherwise absolute", async () => {
        const auto = matcher({ fileLocation: "autoDetect", filePrefix: "/ws" });
        const files = filesOf("/ws/src/a.ts");
        expect((await getResource("src/a.ts", auto, files)).fsPath).toBe("/ws/src/a.ts");
        expect((await getResource("/abs/b.ts", auto, files)).fsPath).toBe("/abs/b.ts");
    });

    it("search: the first file under include whose path ends with the name, files before subdirectories", async () => {
        const files = filesOf("/ws/deep/x/a.ts", "/ws/a.ts", "/ws/skip/b.ts", "/ws/other/b.ts", "/ws/one/two/c.ts");
        const search = (include: string | string[], exclude?: string | string[]) =>
            matcher({ fileLocation: "search", filePrefix: { include, ...(exclude !== undefined ? { exclude } : {}) } });
        expect((await getResource("a.ts", search("/ws"), files)).fsPath).toBe("/ws/a.ts");
        expect((await getResource("b.ts", search(["/ws"], "/ws/skip"), files)).fsPath).toBe("/ws/other/b.ts");
        expect((await getResource("two/c.ts", search(["/nope", "/ws"]), files)).fsPath).toBe("/ws/one/two/c.ts");
        // Not found, or the directory can't be read: absolute.
        expect((await getResource("/abs/z.ts", search("/ws"), files)).fsPath).toBe("/abs/z.ts");
        expect((await getResource("/abs/z.ts", search("/ws"), NO_FILES)).fsPath).toBe("/abs/z.ts");
        expect(
            (await getResource("/abs/z.ts", matcher({ fileLocation: "search", filePrefix: {} }), files)).fsPath,
        ).toBe("/abs/z.ts");
    });

    it("a backslash path becomes a slash path", async () => {
        expect((await getResource("dir\\sub\\x.ts", matcher({}), NO_FILES)).path).toBe("/dir/sub/x.ts");
    });

    it("search: a directory whose name ends with the file name is not the file", async () => {
        const files = filesOf("/ws/a.ts/inner.txt", "/ws/sub/a.ts");
        const search = matcher({ fileLocation: "search", filePrefix: { include: "/ws" } });
        expect((await getResource("a.ts", search, files)).fsPath).toBe("/ws/sub/a.ts");
    });
});

describe("problem matchers — captures, severities, locations", () => {
    const inline = (pattern: unknown, extra: Record<string, unknown> = {}): IProblemMatcher => {
        const { matcher, problems } = parse({ owner: "o", fileLocation: "absolute", pattern, ...extra });
        expect(problems).toStrictEqual([]);
        return matcher!;
    };

    it("file, code, severity and message captures are trimmed", async () => {
        const matcher = inline({
            regexp: "^F([^|]*)\\|L(\\d+)\\|C([^|]*)\\|S([^|]*)\\|M(.*)$",
            file: 1,
            line: 2,
            code: 3,
            severity: 4,
            message: 5,
            // Otherwise the default column group 3 is the code.
            column: 9,
        });
        expect(await matchLines(matcher, ["F /a.js |L3|C E1 |S warning |M  spaced message "])).toStrictEqual([
            {
                resource: "/a.js",
                severity: MarkerSeverity.Warning,
                range: [2, 0, 2, WHOLE_LINE],
                message: "spaced message",
                code: "E1",
            },
        ]);
    });

    it("a marker without code or source has no such keys; an empty code is none", () => {
        const lineMatcher = createLineMatcher(
            inline({ regexp: "^(\\S+):(\\d+) (\\w*) ?(.*)$", file: 1, line: 2, code: 3, message: 4 }),
            NO_FILES,
        );
        expect(lineMatcher.handle(["/a:1  m"], 0).match?.marker).toStrictEqual({
            severity: MarkerSeverity.Error,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: WHOLE_LINE } },
            message: "m",
        });
    });

    it("a group index past the regexp's groups captures nothing", async () => {
        const matcher = inline({ regexp: "^(\\S+):(\\d+) (.*)$", file: 1, line: 2, message: 3, code: 9 });
        expect((await matchLines(matcher, ["/a:1 m"]))[0].code).toBeUndefined();
    });

    it("captured severity letters E/W/I and hint/note; anything else is the matcher's severity", async () => {
        const pattern = { regexp: "^(\\S+):(\\d+) (\\S+) (.*)$", file: 1, line: 2, severity: 3, message: 4 };
        const severities = async (severity: string, lines: string[]) =>
            (await matchLines(inline(pattern, { severity }), lines)).map((f) => f.severity);
        expect(await severities("info", ["/a:1 E m", "/a:1 W m", "/a:1 hint m", "/a:1 e m"])).toStrictEqual([
            MarkerSeverity.Error,
            MarkerSeverity.Warning,
            MarkerSeverity.Info,
            MarkerSeverity.Info,
        ]);
        expect(
            await severities("error", ["/a:1 I m", "/a:1 NOTE m", "/a:1 a-note m", "/a:1 hints m", "/a:1 Warn m"]),
        ).toStrictEqual([
            MarkerSeverity.Info,
            MarkerSeverity.Info,
            MarkerSeverity.Error,
            MarkerSeverity.Error,
            MarkerSeverity.Warning,
        ]);
    });

    it("a location without digits is no match; three numbers are line and column", async () => {
        const matcher = inline({ regexp: "^(\\S+)\\((.*)\\): (.*)$", file: 1, location: 2, message: 3 });
        expect((await matchLines(matcher, ["/a(x): m", "/a(5,6,7): m"])).map((f) => f.range)).toStrictEqual([
            [4, 5, 4, 5],
        ]);
    });

    it("an end column without a start column spans the whole line", async () => {
        const matcher = inline({
            regexp: "^(\\S+) (\\d+):(\\d*)-(\\d+) (.*)$",
            file: 1,
            line: 2,
            column: 3,
            endColumn: 4,
            message: 5,
        });
        expect((await matchLines(matcher, ["/a 2:-9 m"])).map((f) => f.range)).toStrictEqual([[1, 0, 1, WHOLE_LINE]]);
    });

    it("a multi-line problem whose line capture is empty is no match", async () => {
        const matcher = inline([
            { regexp: "^F (.*)$", file: 1 },
            { regexp: "^L (\\d*) (.*)$", line: 1, message: 2 },
        ]);
        expect(await matchLines(matcher, ["F /a", "L  m"])).toStrictEqual([]);
    });

    it("a multi-line message keeps each part trimmed", async () => {
        const matcher = inline([
            { regexp: "^(\\S+):(\\d+) (.*)$", file: 1, line: 2, message: 3 },
            { regexp: "^>(.*)$", message: 1 },
        ]);
        expect((await matchLines(matcher, ["/a:1  head ", ">   tail  "])).map((f) => f.message)).toStrictEqual([
            "head\ntail",
        ]);
    });

    it("parsing ignores case: kind, fileLocation, applyTo, severity names", () => {
        const pattern = { regexp: "^(.*)$", kind: "File", message: 1 };
        expect(
            parse({ owner: "o", pattern, fileLocation: "Absolute", applyTo: "ClosedDocuments", severity: "WARN" })
                .matcher,
        ).toMatchObject({
            fileLocation: "absolute",
            applyTo: "closedDocuments",
            severity: MarkerSeverity.Warning,
            pattern: { kind: "file", file: 1 },
        });
        expect(parse({ owner: "o", pattern, fileLocation: ["AutoDetect", "/b"] }).matcher).toMatchObject({
            fileLocation: "autoDetect",
            filePrefix: "/b",
        });
        expect(parse({ owner: "o", pattern, fileLocation: ["Search", {}] }).matcher).toMatchObject({
            fileLocation: "search",
        });
        expect(parse({ owner: "o", pattern, applyTo: "nonsense" }).matcher?.applyTo).toBe("allDocuments");
    });

    it("kind location on a later line of a multi-line pattern is an error; an empty kind is none", () => {
        expect(
            parse({
                owner: "o",
                pattern: [
                    { regexp: "x", file: 1 },
                    { regexp: "y", line: 1, message: 0, kind: "Location" },
                ],
            }).problems[0],
        ).toBe("The problem pattern is invalid. The kind property must be provided only in the first element");
        expect(parse({ owner: "o", pattern: { regexp: "x", kind: "" } }).matcher?.pattern).toMatchObject({
            kind: "location",
            line: 2,
        });
    });

    it("pattern defaults: location group 0 is no location; kind file needs no line", () => {
        expect(parseProblemPattern({ regexp: "x", location: 0 }, () => undefined)).toMatchObject({
            line: 2,
            character: 3,
        });
        const fileOnly = parseProblemPattern({ regexp: "x", kind: "file" }, () => undefined) as IProblemPattern;
        expect([fileOnly.line, fileOnly.file, fileOnly.message]).toStrictEqual([undefined, 1, 0]);
    });

    it("base: an empty source or a non-string severity keeps the base's", () => {
        expect(parse({ base: "$eslint-stylish", source: "", severity: 3 }).matcher).toStrictEqual(
            builtin("eslint-stylish"),
        );
    });

    it("a source is kept only when non-empty; an empty or null pattern is no pattern", () => {
        const pattern = { regexp: "^(.*)$", kind: "file", message: 1 };
        expect(parse({ owner: "o", pattern, source: "" }).matcher?.source).toBeUndefined();
        expect(parse({ owner: "o", pattern: "" }).matcher).toBeUndefined();
        expect(parse({ owner: "o", pattern: null }).problems).toHaveLength(1);
    });
});
