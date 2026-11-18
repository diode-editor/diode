import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { Hover, MarkdownString, Position, Range, Uri } from "./vscodeTypes.ts";

describe("vscode.executeHoverProvider as an extension sees it", () => {
    let dir: string;
    let file: Uri;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-execute-hover-"));
        writeFileSync(join(dir, "a.json"), '{ "title": 1 }   \n');
        file = Uri.file(join(dir, "a.json"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function setup() {
        const stub = makeStubRpc();
        stub.responder = (method: string) =>
            method === "languages.getLanguageOfDocument" ? { languageId: "json" } : undefined;
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
        return namespace;
    }

    async function hoverTexts(api: typeof vscode, position: Position): Promise<string[]> {
        const hovers = await api.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", file, position);
        return hovers.map((hover) => (hover.contents[0] as vscode.MarkdownString).value);
    }

    it("puts the later registration first when two selectors score the same, like the editor's provider registry", async () => {
        // upstream LanguageFeatureRegistry._compareByScoreAndTime and docs/arch/Extensions.md:
        // by score descending, on equal score the later registration first.
        const api = setup();
        api.languages.registerHoverProvider("*", { provideHover: () => new Hover("any language") });
        api.languages.registerHoverProvider({ language: "json" }, { provideHover: () => new Hover("first json") });
        api.languages.registerHoverProvider({ language: "json" }, { provideHover: () => new Hover("second json") });

        await expect(hoverTexts(api, new Position(0, 4))).resolves.toEqual([
            "second json",
            "first json",
            "any language",
        ]);
    });

    it("keeps provider order when an earlier provider answers last", async () => {
        const api = setup();
        api.languages.registerHoverProvider("*", {
            provideHover: () =>
                new Promise<vscode.Hover>((resolve) =>
                    setTimeout(() => {
                        resolve(new Hover("slow"));
                    }, 20),
                ),
        });
        api.languages.registerHoverProvider("json", { provideHover: () => new Hover("fast") });

        await expect(hoverTexts(api, new Position(0, 4))).resolves.toEqual(["fast", "slow"]);
    });

    it("drops failing and empty providers and still answers with the others", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const api = setup();
        api.languages.registerHoverProvider("json", { provideHover: () => new Hover("kept") });
        api.languages.registerHoverProvider("json", {
            provideHover: () => {
                throw new Error("boom");
            },
        });
        api.languages.registerHoverProvider("json", { provideHover: () => Promise.reject(new Error("rejected")) });
        api.languages.registerHoverProvider("json", { provideHover: () => undefined });
        api.languages.registerHoverProvider("json", { provideHover: () => new Hover([]) });
        api.languages.registerHoverProvider("python", { provideHover: () => new Hover("other language") });

        await expect(hoverTexts(api, new Position(0, 4))).resolves.toEqual(["kept"]);
    });

    it("gives a hover in whitespace an empty range at the position", async () => {
        const api = setup();
        api.languages.registerHoverProvider("json", { provideHover: () => new Hover("doc") });

        const hovers = await api.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            file,
            new Position(0, 16),
        );

        expect(hovers.map((hover) => hover.range)).toEqual([new Range(0, 16, 0, 16)]);
    });

    it("fences a {language, value} block and keeps MarkdownString flags", async () => {
        const api = setup();
        const markdown = new MarkdownString("$(zap) **bold**", true);
        markdown.isTrusted = true;
        api.languages.registerHoverProvider("json", {
            provideHover: () => new Hover([{ language: "ts", value: "let x" }, markdown]),
        });

        const [hover] = await api.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            file,
            new Position(0, 4),
        );

        expect(hover.contents.map((content) => content instanceof MarkdownString)).toEqual([true, true]);
        expect(hover.contents.map((content) => (content as vscode.MarkdownString).value)).toEqual([
            "```ts\nlet x\n```\n",
            "$(zap) **bold**",
        ]);
        expect((hover.contents[1] as vscode.MarkdownString).isTrusted).toBe(true);
        expect((hover.contents[1] as vscode.MarkdownString).supportThemeIcons).toBe(true);
    });
});
