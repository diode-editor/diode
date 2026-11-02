import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideDefinitions } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { ensureGopls, goToolchainMissing, type IInstalledGo, installGo } from "../../../../../TestUtils/goFixture.ts";
import { type IGoLspSession, openGoFile } from "../../../../../TestUtils/goLspSession.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { LinksService } from "../../../contrib/links/browser/linksService.ts";

// gopls links an import to pkg.go.dev, gated by `ui.navigation.importShortcut`. The opening is the real service; only
// the browser is a fake (the toast of a session without a browser is in the `go-navigation` scenario).

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

let installed: IInstalledGo;
let gopls: string;

function askLinks({ harness, editor }: IGoLspSession): Promise<readonly ILink[]> {
    const document = editor.viewState.document;
    return getLinks(
        harness.languageFeatures.documentLinkProvider,
        editor,
        { uri: editor.uri.toString(), languageId: editor.languageId, versionId: document.versionId, document },
        CancellationTokenNone,
    );
}

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)("ExtensionHost — links of stock golang.go", () => {
    beforeAll(async () => {
        gopls = ensureGopls();
        installed = await installGo();
    }, 600_000);

    afterAll(() => {
        installed.dispose();
    });

    it('`import "fmt"` is a link on the path, opening it reaches pkg.go.dev/fmt', { timeout: 300_000 }, async () => {
        const session = await openGoFile(installed, gopls, "greet/greeter.go");
        try {
            const { harness, editor, at, clientCrashes } = session;
            await waitUntil("the provider", () => harness.languageFeatures.documentLinkProvider.has(editor));
            const links = await until("the import link", async () => {
                const found = await askLinks(session);
                return found.length > 0 ? found : null;
            });

            const path = at('"fmt"', 1);
            expect(links).toHaveLength(1);
            expect(links[0].range.start).toEqual({ line: path.line, character: path.character });
            expect(links[0].range.end).toEqual({ line: path.line, character: path.character + "fmt".length });

            const browser = { open: vi.fn((_url: string) => Promise.resolve(true)) };
            const clicked = new Emitter<ILink>();
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
                { show: vi.fn() } as never,
            );
            clicked.fire(links[0]);
            await vi.waitFor(() => {
                expect(browser.open).toHaveBeenCalledTimes(1);
            });
            expect(browser.open.mock.calls[0][0]).toMatch(/^https:\/\/pkg\.go\.dev\/fmt(\?|$)/);
            expect(clientCrashes()).toEqual([]);
        } finally {
            await session.harness.dispose();
        }
    });

    it(
        '"ui.navigation.importShortcut": "Definition" leaves the import without a link',
        {
            timeout: 300_000,
        },
        async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go", {
                "ui.navigation.importShortcut": "Definition",
            });
            try {
                const { harness, editor, at } = session;
                await waitUntil("the provider", () => harness.languageFeatures.documentLinkProvider.has(editor));
                // Wait until gopls has loaded the package: its answer before that says nothing about the setting.
                await until("gopls answering about the file", async () => {
                    const targets = await provideDefinitions(harness, at("Hello(e.Name)"));
                    return targets.length > 0 ? targets : null;
                });

                await expect(askLinks(session)).resolves.toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        },
    );
});
