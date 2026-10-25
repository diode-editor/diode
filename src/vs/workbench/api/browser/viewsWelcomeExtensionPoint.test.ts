import { describe, expect, it } from "vitest";

import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import { readViewsWelcome, targetOf, welcomeBlocks } from "./viewsWelcomeExtensionPoint.ts";

function extension(id: string, viewsWelcome: unknown): IExtension {
    return { id, manifest: { name: id, contributes: { viewsWelcome } } } as unknown as IExtension;
}

function read(...extensions: IExtension[]): { readonly byView: unknown; readonly errors: string[] } {
    const errors: string[] = [];
    const logger = { error: (line: string) => errors.push(line), warn: () => undefined } as unknown as ILogger;
    return { byView: Object.fromEntries(readViewsWelcome(extensions, logger)), errors };
}

describe("readViewsWelcome", () => {
    it("groups the entries by view in manifest order, across extensions", () => {
        const { byView, errors } = read(
            extension("a.one", [
                { view: "v1", contents: "first", when: "k" },
                { view: "v2", contents: "other" },
                { view: "v1", contents: "second", when: "default", enablement: "e" },
            ]),
            extension("b.two", [{ view: "v1", contents: "third" }]),
        );

        expect(byView).toEqual({
            v1: [
                { contents: "first", when: "k", enablement: undefined },
                { contents: "second", when: "default", enablement: "e" },
                { contents: "third", when: undefined, enablement: undefined },
            ],
            v2: [{ contents: "other", when: undefined, enablement: undefined }],
        });
        expect(errors).toEqual([]);
    });

    it("an entry without a string view or contents is skipped with a log line; the others stay", () => {
        const { byView, errors } = read(
            extension("a.one", [
                { view: "v1" },
                { contents: "no view" },
                { view: 3, contents: "x" },
                null,
                "text",
                { view: "v1", contents: "kept" },
            ]),
        );

        expect(byView).toEqual({ v1: [{ contents: "kept", when: undefined, enablement: undefined }] });
        expect(errors).toEqual(
            Array.from(
                { length: 5 },
                () => "a.one: viewsWelcome: properties `view` and `contents` are mandatory and must be strings",
            ),
        );
    });

    it("a non-string when or enablement reads as none; group (proposed API) is ignored", () => {
        const { byView } = read(
            extension("a.one", [{ view: "v", contents: "c", when: true, enablement: 1, group: "g@1" }]),
        );

        expect(byView).toEqual({ v: [{ contents: "c", when: undefined, enablement: undefined }] });
    });

    it("viewsWelcome that is not an array is a log line", () => {
        const { byView, errors } = read(
            extension("a.one", { view: "v", contents: "c" }),
            extension("b.two", undefined),
        );

        expect(byView).toEqual({});
        expect(errors).toEqual(["a.one: viewsWelcome must be an array"]);
    });

    it("works without a logger", () => {
        expect(readViewsWelcome([extension("a.one", [{}]), extension("b.two", 1)]).size).toBe(0);
    });
});

describe("welcomeBlocks", () => {
    it("a line that is exactly one link is a button, other lines are paragraphs, separated by gaps", () => {
        expect(
            welcomeBlocks([
                {
                    contents:
                        "  There are no open Terraform files.  \n\n   \n[Open Settings](command:terraform.openSettingsJson)\nRead [the docs](https://example.invalid/docs) first.",
                },
            ]),
        ).toEqual([
            { kind: "paragraph", nodes: ["There are no open Terraform files."] },
            { kind: "text", text: "" },
            { kind: "button", label: "Open Settings", command: "terraform.openSettingsJson", args: [] },
            { kind: "text", text: "" },
            {
                kind: "paragraph",
                nodes: ["Read ", { label: "the docs", url: "https://example.invalid/docs" }, " first."],
            },
        ]);
    });

    it("entries follow each other with a gap; empty contents add nothing", () => {
        expect(welcomeBlocks([{ contents: "one" }, { contents: " \n " }, { contents: "two" }])).toEqual([
            { kind: "paragraph", nodes: ["one"] },
            { kind: "text", text: "" },
            { kind: "paragraph", nodes: ["two"] },
        ]);
    });

    it("enablement goes to the entry's buttons and command links, not to web links", () => {
        expect(
            welcomeBlocks([
                {
                    contents: "[Go](command:go)\n[a](command:a) [b](https://b.invalid)\n[Web](https://w.invalid)",
                    enablement: "ready",
                },
                { contents: "[Other](command:other)" },
            ]),
        ).toEqual([
            { kind: "button", label: "Go", command: "go", args: [], enablement: "ready" },
            { kind: "text", text: "" },
            {
                kind: "paragraph",
                nodes: [
                    { label: "a", command: "a", args: [], enablement: "ready" },
                    " ",
                    { label: "b", url: "https://b.invalid" },
                ],
            },
            { kind: "text", text: "" },
            { kind: "button", label: "Web", url: "https://w.invalid" },
            { kind: "text", text: "" },
            { kind: "button", label: "Other", command: "other", args: [], enablement: undefined },
        ]);
    });

    it("a line with a link and text around it stays a paragraph", () => {
        expect(welcomeBlocks([{ contents: "[a](command:a)." }])).toEqual([
            { kind: "paragraph", nodes: [{ label: "a", command: "a", args: [], enablement: undefined }, "."] },
        ]);
    });

    it("unicode text passes through", () => {
        expect(welcomeBlocks([{ contents: "Κανένα αρχείο — 日本 [άνοιγμα](command:open)" }])).toEqual([
            {
                kind: "paragraph",
                nodes: [
                    "Κανένα αρχείο — 日本 ",
                    { label: "άνοιγμα", command: "open", args: [], enablement: undefined },
                ],
            },
        ]);
    });
});

describe("targetOf", () => {
    it.each([
        ["command:foo", { command: "foo", args: [] }],
        ["command:foo?%5B1%2C%22two%22%5D", { command: "foo", args: [1, "two"] }],
        ['command:foo?["a",{"b":2}]', { command: "foo", args: ["a", { b: 2 }] }],
        ["command:foo?%7B%22x%22%3A1%7D", { command: "foo", args: [{ x: 1 }] }],
        ["command:foo?42", { command: "foo", args: [42] }],
        ["command:foo?not-json", { command: "foo", args: [] }],
        ["command:foo?%E0%A4%A", { command: "foo", args: [] }],
        ["https://example.invalid/a?b=1", { url: "https://example.invalid/a?b=1" }],
        ["file:///tmp/a.tf", { url: "file:///tmp/a.tf" }],
    ])("%s", (href, target) => {
        expect(targetOf(href)).toEqual(target);
    });
});
