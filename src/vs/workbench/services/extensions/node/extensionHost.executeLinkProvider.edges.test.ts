import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerDefaultLinkProvider } from "../../../../editor/contrib/links/browser/defaultLinkProvider.ts";
import { ExecuteLinkProviderCommandContribution } from "../../../contrib/links/browser/executeLinkProviderCommand.ts";

// Edge cases of `vscode.executeLinkProvider` as an extension sees them: what the API command answers for failing
// providers, overlapping links, link resolution counts, unicode text, unsaved edits and documents the extension
// opened itself. Expectations follow upstream `_executeLinkProvider` (getLinks.ts) unless the PR documents a deviation.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.linkProviderEdges", "linkProviderEdges.cjs");

interface IPlainLink {
    readonly range: readonly [number, number, number, number];
    readonly target?: string;
    readonly tooltip?: string;
}

async function withDocument(
    content: string,
    body: (harness: IExtensionHarness, uri: string) => Promise<void>,
): Promise<void> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
    });
    try {
        const editor = harness.group.getActiveEditor();
        if (editor === null) throw new Error("no active editor");
        registerDefaultLinkProvider(harness.languageFeatures);
        const contribution = new ExecuteLinkProviderCommandContribution(
            harness.commandRegistry,
            harness.group,
            harness.languageFeatures,
        );
        await waitUntil("the extension's commands", () => harness.commandRegistry.has("test.links.run"));
        try {
            await body(harness, editor.uri.toString());
        } finally {
            contribution.dispose();
        }
    } finally {
        await harness.dispose();
    }
}

function run(harness: IExtensionHarness, uri: string, ...rest: unknown[]): Promise<IPlainLink[]> {
    return harness.commandRegistry.execute("test.links.run", uri, ...rest) as Promise<IPlainLink[]>;
}

describe("ExtensionHost — vscode.executeLinkProvider edge cases (subprocess)", () => {
    it("resolves nothing without linkResolveCount and everything when the count exceeds the links", async () => {
        await withDocument("lib:a lib:b\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([
                { range: [0, 0, 0, 5], tooltip: "a" },
                { range: [0, 6, 0, 11], tooltip: "b" },
            ]);
            await expect(run(harness, uri, 100)).resolves.toEqual([
                { range: [0, 0, 0, 5], target: "https://lib.example/a", tooltip: "a" },
                { range: [0, 6, 0, 11], target: "https://lib.example/b", tooltip: "b" },
            ]);
        });
    });

    it("counts a link that already has a target toward the first linkResolveCount", async () => {
        await withDocument("tgt:file lib:a\n", async (harness, uri) => {
            await expect(run(harness, uri, 1)).resolves.toEqual([
                { range: [0, 0, 0, 8], target: "file:///tmp/target.txt" },
                { range: [0, 9, 0, 14], tooltip: "a" },
            ]);
        });
    });

    it("keeps file: and command: targets of provider links", async () => {
        await withDocument("tgt:file\ntgt:cmd\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([
                { range: [0, 0, 0, 8], target: "file:///tmp/target.txt" },
                { range: [1, 0, 1, 7], target: "command:test.noop" },
            ]);
        });
    });

    it("answers the other providers and the URL detector when one provider throws", async () => {
        await withDocument("THROW lib:a https://x.example/p\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([
                { range: [0, 6, 0, 11], tooltip: "a" },
                { range: [0, 12, 0, 31], target: "https://x.example/p" },
            ]);
        });
    });

    it("leaves a link without target when its resolve throws or answers nothing, and resolves the rest", async () => {
        await withDocument("lib:boom lib:none lib:ok\n", async (harness, uri) => {
            await expect(run(harness, uri, 3)).resolves.toEqual([
                { range: [0, 0, 0, 8], tooltip: "boom" },
                { range: [0, 9, 0, 17], tooltip: "none" },
                { range: [0, 18, 0, 24], target: "https://lib.example/ok", tooltip: "ok" },
            ]);
        });
    });

    it("lets the extension's link win over the detected URL it overlaps", async () => {
        await withDocument("see https://own.example/page\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([
                { range: [0, 4, 0, 28], target: "https://own.example/claimed", tooltip: "own" },
            ]);
        });
    });

    it("keeps one link where two extension providers overlap — the later registered, as upstream", async () => {
        await withDocument("ovr:x\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([{ range: [0, 0, 0, 5], tooltip: "second" }]);
        });
    });

    it("reports UTF-16 columns after emoji and CJK text", async () => {
        await withDocument("😀日本 https://u.example/ü lib:a\n", async (harness, uri) => {
            await expect(run(harness, uri)).resolves.toEqual([
                { range: [0, 5, 0, 24], target: "https://u.example/%C3%BC" },
                { range: [0, 25, 0, 30], tooltip: "a" },
            ]);
        });
    });

    it("sees unsaved edits the extension just applied", async () => {
        await withDocument("text\n", async (harness, uri) => {
            await expect(
                harness.commandRegistry.execute("test.links.editThenRun", uri, "https://new.example/a "),
            ).resolves.toEqual([{ range: [0, 0, 0, 21], target: "https://new.example/a" }]);
        });
    });

    it("answers links for a document the extension opened with openTextDocument", async () => {
        await withDocument("x\n", async (harness) => {
            const fsPath = harness.writeFile("other.ts", "lib:a https://o.example/b\n");
            await expect(harness.commandRegistry.execute("test.links.openThenRun", fsPath)).resolves.toEqual([
                { range: [0, 0, 0, 5], tooltip: "a" },
                { range: [0, 6, 0, 25], target: "https://o.example/b" },
            ]);
        });
    });

    it("rejects a non-Uri argument and a non-number linkResolveCount", async () => {
        await withDocument("x\n", async (harness, uri) => {
            const notUri = (await harness.commandRegistry.execute("test.links.raw", uri, false)) as { error?: string };
            expect(notUri.error).toBeDefined();
            const badCount = (await harness.commandRegistry.execute("test.links.raw", uri, true, "2")) as {
                error?: string;
            };
            expect(badCount.error).toBeDefined();
        });
    });
});
