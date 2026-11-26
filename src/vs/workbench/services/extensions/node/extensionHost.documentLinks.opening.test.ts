import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { LinksService } from "../../../contrib/links/browser/linksService.ts";

// What the user gets on opening a provider's link: the url handed to the browser, or the toast. The links come from a
// real extension in the subprocess, and the opening is the real service; only the browser and the toasts are fakes.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesDocumentLinksTargets", "providesDocumentLinksTargets.cjs");

describe("ExtensionHost — opening the links of a provider (subprocess)", () => {
    let harness: IExtensionHarness;
    let clicked: Emitter<ILink>;
    const browser = { open: vi.fn((_url: string) => Promise.resolve(true)) };
    const toasts = { show: vi.fn() };

    /** The list one editor pane asks for: every pane of a document holds its own. */
    async function askLinks(): Promise<readonly ILink[]> {
        const editor = harness.group.getActiveEditor();
        if (editor === null) throw new Error("no active editor");
        const document = editor.viewState.document;
        return getLinks(
            harness.languageFeatures.documentLinkProvider,
            editor,
            { uri: editor.uri.toString(), languageId: editor.languageId, versionId: document.versionId, document },
            CancellationTokenNone,
        );
    }

    async function open(link: ILink): Promise<void> {
        clicked.fire(link);
        await vi.waitFor(() => {
            expect(browser.open.mock.calls.length + toasts.show.mock.calls.length).toBe(1);
        });
    }

    beforeEach(async () => {
        browser.open.mockClear();
        toasts.show.mockClear();
        clicked = new Emitter<ILink>();
        harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "// QUERY\n// VERSION\n// MAIL\n// TODO\n" },
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [FIXTURE],
        });
        const editor = harness.group.getActiveEditor();
        if (editor === null) throw new Error("no active editor");
        await waitUntil(
            "the provider",
            () => harness.languageFeatures.documentLinkProvider.ordered(editor).length === 1,
        );
        const pane = { uri: editor.uri, onDidClickLink: clicked.event, getLinksAtSelections: () => [] };
        new LinksService(
            {
                getActiveEditor: () => pane,
                onActiveEditorChanged: new Emitter<unknown>().event,
                editorGroups: { activeGroup: { findPaneIndex: () => -1 }, groups: [] },
                openUri: () => Promise.resolve(),
            } as never,
            { jumpAsync: (run: () => Promise<void>) => run() } as never,
            browser,
            { has: () => true, execute: () => Promise.resolve() } as never,
            toasts as never,
        );
    });

    afterEach(async () => {
        await harness.dispose();
    });

    it.each([
        [0, "https://registry.example/docs/x?utm_source=diode&utm_content=a,b#frag"],
        [1, "https://pkg.example/golang.org/x/net@v0.1.0/html"],
        [2, "mailto:a@b.example"],
    ])("target %i reaches the browser the way the provider wrote it", async (index, url) => {
        const links = await askLinks();
        await open(links[index]);
        expect(browser.open).toHaveBeenCalledWith(url);
    });

    it("a resolved target reaches the browser the way the provider wrote it", async () => {
        const links = await askLinks();
        await open(links[3]);
        expect(browser.open).toHaveBeenCalledWith("https://provider.example/resolved?a=b");
    });

    it("a link without a target opens in the first of three splits of a document", async () => {
        const firstPane = await askLinks();
        await askLinks();
        await askLinks();
        await open(firstPane[3]);
        expect(toasts.show).not.toHaveBeenCalled();
        expect(browser.open).toHaveBeenCalledTimes(1);
    });
});
