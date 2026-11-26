import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRowSpan } from "../../../browser/parts/views/lazyTreeControl.ts";

import { detectLinks, LinkDetector, pathLinkRegex } from "./linkDetector.ts";

describe("detectLinks", () => {
    it("finds web links first, then paths with a line and a column in the rest", () => {
        expect(detectLinks("see https://example.com/a?b=1, then /src/app.ts:3:5 done")).toEqual([
            { kind: "text", value: "see ", captures: [], index: 0 },
            { kind: "web", value: "https://example.com/a?b=1", captures: [], index: 4 },
            { kind: "text", value: ", then ", captures: [], index: 29 },
            { kind: "path", value: "/src/app.ts:3:5", captures: ["/src/app.ts", "3", "5"], index: 36 },
            { kind: "text", value: " done", captures: [], index: 51 },
        ]);
    });

    it("takes `:line N`, a home or relative path, a path without a position", () => {
        expect(detectLinks("at ./a/b.js:line 12")[1]).toMatchObject({
            kind: "path",
            captures: ["./a/b.js", "12", undefined],
        });
        expect(detectLinks("~/x.c")[0]).toMatchObject({ kind: "path", captures: ["~/x.c", undefined, undefined] });
        expect(detectLinks("www.example.org!")[0]).toMatchObject({ kind: "web", value: "www.example.org" });
    });

    it("leaves a text longer than 2000 alone and a text without links as one part", () => {
        // 2001 characters; 2000 are searched.
        const long = `/a/b.ts,${"x".repeat(1993)}`;
        expect(detectLinks(long)).toEqual([{ kind: "text", value: long, captures: [], index: 0 }]);
        expect(detectLinks(long.slice(0, 2000))[0]).toMatchObject({ kind: "path", value: "/a/b.ts" });
        expect(detectLinks("plain")).toEqual([{ kind: "text", value: "plain", captures: [], index: 0 }]);
        expect(detectLinks("")).toEqual([]);
    });

    it("on Windows takes a drive path and a home or relative one with either slash, not a root one", () => {
        const matches = (text: string) => [...text.matchAll(pathLinkRegex(true))].map((match) => [...match]);
        expect(matches(String.raw`at C:\src\app.ts:3:5 and ~/x.c, .\a\b.js:line 2`)).toEqual([
            [String.raw`C:\src\app.ts:3:5`, String.raw`C:\src\app.ts`, "3", "5"],
            ["~/x.c", "~/x.c", undefined, undefined],
            [String.raw`.\a\b.js:line 2`, String.raw`.\a\b.js`, "2", undefined],
        ]);
        expect(matches("/src/app.ts")).toEqual([]);
    });
});

describe("LinkDetector", () => {
    let opened: string[];
    let files: Map<string, boolean>;
    let detector: LinkDetector;
    let active: Uri | undefined;

    beforeEach(() => {
        opened = [];
        active = undefined;
        // fsPath → is a directory.
        files = new Map([
            ["/src/app.ts", false],
            ["/src", true],
            ["/home/u/notes.txt", false],
            ["/ws/rel/a.ts", false],
        ]);
        detector = new LinkDetector(
            {
                stat: (uri: Uri) => {
                    const isDirectory = files.get(uri.fsPath);
                    return isDirectory === undefined
                        ? Promise.reject(new Error("missing"))
                        : Promise.resolve({ isDirectory } as never);
                },
            },
            {
                editorGroups: { activeGroup: { findPaneIndex: () => -1 }, groups: [] },
                openUri: (uri: Uri) => {
                    active = uri;
                    opened.push(uri.fsPath);
                    return Promise.resolve();
                },
                getActiveEditor: () => ({
                    uri: active,
                    goToPosition: (line: number, column: number) => {
                        opened.push(`@${String(line)}:${String(column)}`);
                    },
                }),
            } as never,
            { jumpAsync: async (run: () => Promise<void>) => run() } as never,
            {
                open: (url: string) => {
                    opened.push(url);
                    return Promise.resolve(true);
                },
            },
            { userHome: "/home/u" },
        );
    });

    const folder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

    function linkOf(spans: readonly IRowSpan[], text: string): () => void {
        const span = spans.find((s) => s.text === text);
        if (span?.link === undefined) throw new Error(`no link ${text}`);
        return span.link;
    }

    it("cuts the styled pieces at the links and underlines the links over their own style", () => {
        const spans = detector.linkify(
            [
                { text: "at /src/ap", fg: "terminal.ansiRed" },
                { text: "p.ts:3 x", style: StyleFlags.Bold },
            ],
            undefined,
        );
        expect(spans.map(({ link: _, ...rest }) => rest)).toEqual([
            { text: "at ", fg: "terminal.ansiRed" },
            { text: "/src/ap", fg: "terminal.ansiRed", style: StyleFlags.Underline },
            { text: "p.ts:3", style: StyleFlags.Bold | StyleFlags.Underline },
            { text: " x", style: StyleFlags.Bold },
        ]);
        expect(spans[1].link).toBe(spans[2].link);
        expect(spans[0].link).toBeUndefined();
    });

    it("gives back pieces without links as they are", () => {
        const spans = [{ text: "nothing here" }];
        expect(detector.linkify(spans, folder)).toEqual(spans);
    });

    it("a link that starts at a piece's end leaves no empty piece behind", () => {
        const spans = detector.linkify([{ text: "see " }, { text: "/src/app.ts" }, { text: ", done" }], undefined);
        expect(spans.map(({ text, link }) => [text, link !== undefined])).toEqual([
            ["see ", false],
            ["/src/app.ts", true],
            [", done", false],
        ]);
    });

    it("finds the paths between web links at their place in the text", () => {
        const text = "https://a.example/x /src/app.ts:2 https://b.example/y";
        expect(detectLinks(text).map(({ kind, index }) => [kind, index])).toEqual([
            ["web", 0],
            ["text", 19],
            ["path", 20],
            ["text", 33],
            ["web", 34],
        ]);
        expect(detector.linkify([{ text }], undefined).map((span) => span.text)).toEqual([
            "https://a.example/x",
            " ",
            "/src/app.ts:2",
            " ",
            "https://b.example/y",
        ]);
    });

    it("a link that fails to open goes to the unexpected errors", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        try {
            const failing = new LinkDetector(
                { stat: () => Promise.reject(new Error("no stat")) },
                {} as never,
                {} as never,
                { open: () => Promise.reject(new Error("no opener")) },
                { userHome: "/home/u" },
            );
            linkOf(failing.linkify([{ text: "https://example.com/x" }], undefined), "https://example.com/x")();
            await vi.waitFor(() => {
                expect(errors).toEqual([new Error("no opener")]);
            });
        } finally {
            setUnexpectedErrorHandler((e) => {
                console.error(e);
            });
        }
    });

    it("a file link opens the file at its 1-based line and column; without a column at its start", async () => {
        linkOf(detector.linkify([{ text: "/src/app.ts:3:5" }], undefined), "/src/app.ts:3:5")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts", "@2:4"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "~/notes.txt:7" }], undefined), "~/notes.txt:7")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/home/u/notes.txt", "@6:0"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "/src/app.ts" }], undefined), "/src/app.ts")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts"]);
        });
        // Line 0 is no line; column 0 is the line's start.
        opened = [];
        linkOf(detector.linkify([{ text: "/src/app.ts:0" }], undefined), "/src/app.ts:0")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "/src/app.ts:3:0" }], undefined), "/src/app.ts:3:0")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts", "@2:0"]);
        });
    });

    it("a relative path opens in the session's folder; without a folder it is text", async () => {
        linkOf(detector.linkify([{ text: "./rel/a.ts:2" }], folder), "./rel/a.ts:2")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/ws/rel/a.ts", "@1:0"]);
        });
        expect(detector.linkify([{ text: "./rel/a.ts:2" }], undefined)[0].link).toBeUndefined();
    });

    it("a folder and a missing file open nothing", async () => {
        linkOf(detector.linkify([{ text: "/src" }], undefined), "/src")();
        linkOf(detector.linkify([{ text: "/nope.ts" }], undefined), "/nope.ts")();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(opened).toEqual([]);
    });

    it("a web link goes to the system's opener; a file:// link opens the file at its position", async () => {
        linkOf(detector.linkify([{ text: "https://example.com/x" }], undefined), "https://example.com/x")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["https://example.com/x"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "file:///src/app.ts:4:2" }], undefined), "file:///src/app.ts:4:2")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts", "@3:1"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "file:///src/app.ts" }], undefined), "file:///src/app.ts")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts"]);
        });
        opened = [];
        linkOf(detector.linkify([{ text: "file:///src/app.ts:4" }], undefined), "file:///src/app.ts:4")();
        await vi.waitFor(() => {
            expect(opened).toEqual(["/src/app.ts", "@3:0"]);
        });
    });
});
