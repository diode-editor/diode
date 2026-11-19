import { afterEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { registerDefaultLinkProvider } from "../../../../editor/contrib/links/browser/defaultLinkProvider.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import { ExecuteLinkProviderCommandContribution } from "./executeLinkProviderCommand.ts";

const TEXT = "see lib:one https://example.com/x\nlib:two\n";

/** `lib:one` and `lib:two` without a target, as a provider with `resolveDocumentLink` answers. */
function libraryLinks(resolve: (name: string) => Promise<string | null>): ILink[] {
    return [
        { range: createRange(0, 4, 0, 11), tooltip: "one", resolve: () => resolve("one") },
        { range: createRange(1, 0, 1, 7), resolve: () => resolve("two") },
    ];
}

describe("_executeLinkProvider", () => {
    const toDispose: { dispose(): void }[] = [];
    afterEach(() => {
        for (const item of toDispose.splice(0)) item.dispose();
    });

    function setup(models: { untitled?: boolean } = {}): {
        execute: (...args: unknown[]) => Promise<unknown>;
        uri: Uri;
        languageFeatures: LanguageFeaturesService;
    } {
        const untitled = models.untitled === true;
        const uri = untitled ? Uri.parse("untitled:Untitled-1") : Uri.file("/ws/readme.md");
        const model = { uri, languageId: "markdown", document: new TextDocument(TEXT) };
        const editors = {
            getTextSurfaces: () => [],
            getUntitledModelsWithoutEditor: () => (untitled ? [model] : []),
            getFileModelsWithoutEditor: () => (untitled ? [] : [model]),
        } as unknown as IEditorService;
        const languageFeatures = new LanguageFeaturesService();
        toDispose.push(registerDefaultLinkProvider(languageFeatures));
        const commands = new CommandRegistry();
        toDispose.push(new ExecuteLinkProviderCommandContribution(commands, editors, languageFeatures));
        // As the extension host sends them: through JSON, the uri as its components.
        const execute = (...args: unknown[]): Promise<unknown> =>
            Promise.resolve(
                commands.execute("_executeLinkProvider", ...(JSON.parse(JSON.stringify(args)) as unknown[])),
            );
        return { execute, uri, languageFeatures };
    }

    it("answers the providers' links and the detected URL by position, resolving the first linkResolveCount", async () => {
        const { execute, uri, languageFeatures } = setup();
        const resolve = vi.fn((name: string) => Promise.resolve(`file:///lib/${name}`));
        languageFeatures.documentLinkProvider.register("markdown", {
            provideLinks: () => Promise.resolve(libraryLinks(resolve)),
        });

        // The second link already has its target: the count reaches `lib:two` only past it.
        await expect(execute(uri, 2)).resolves.toEqual([
            { range: createRange(0, 4, 0, 11), target: "file:///lib/one", tooltip: "one" },
            { range: createRange(0, 12, 0, 33), target: "https://example.com/x" },
            { range: createRange(1, 0, 1, 7) },
        ]);
        expect(resolve.mock.calls).toEqual([["one"]]);
    });

    it("without linkResolveCount nothing is resolved; a count past the links resolves them all", async () => {
        const { execute, uri, languageFeatures } = setup();
        const resolve = vi.fn((name: string) => Promise.resolve(`file:///lib/${name}`));
        languageFeatures.documentLinkProvider.register("markdown", {
            provideLinks: () => Promise.resolve(libraryLinks(resolve)),
        });

        const unresolved = (await execute(uri)) as { target?: string }[];
        expect(unresolved.map((link) => link.target)).toEqual([undefined, "https://example.com/x", undefined]);
        expect(resolve).not.toHaveBeenCalled();

        const all = (await execute(uri, 10)) as { target?: string }[];
        expect(all.map((link) => link.target)).toEqual(["file:///lib/one", "https://example.com/x", "file:///lib/two"]);
    });

    it("a resolve without a target leaves the link without one", async () => {
        const { execute, uri, languageFeatures } = setup();
        languageFeatures.documentLinkProvider.register("markdown", {
            provideLinks: () => Promise.resolve(libraryLinks(() => Promise.resolve(null))),
        });

        const links = (await execute(uri, 1)) as unknown[];

        expect(links[0]).toEqual({ range: createRange(0, 4, 0, 11), tooltip: "one" });
    });

    it("a failing provider does not fail the command: the others answer", async () => {
        const { execute, uri, languageFeatures } = setup();
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((error) => errors.push(error));
        languageFeatures.documentLinkProvider.register("markdown", {
            provideLinks: () => Promise.reject(new Error("provider failed")),
        });

        await expect(execute(uri)).resolves.toEqual([
            { range: createRange(0, 12, 0, 33), target: "https://example.com/x" },
        ]);
        expect(errors).toHaveLength(1);
    });

    it("finds an untitled document too", async () => {
        const { execute, uri } = setup({ untitled: true });

        await expect(execute(uri)).resolves.toHaveLength(1);
    });

    it("a document that is not loaded, or no uri at all, answers an empty list, as upstream", async () => {
        const { execute } = setup();

        await expect(execute(Uri.file("/ws/other.md"))).resolves.toEqual([]);
        await expect(execute(null)).resolves.toEqual([]);
    });
});
