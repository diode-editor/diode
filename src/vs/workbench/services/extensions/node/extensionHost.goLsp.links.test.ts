import { expect, it } from "vitest";

import { describeStockGo, type IGoLspSession } from "../../../../../TestUtils/goLspSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { getLinks } from "../../../../editor/contrib/links/browser/getLinks.ts";

// gopls links an import to pkg.go.dev, gated by `ui.navigation.importShortcut`. Opening the link, down to the toast of
// a session without a browser, is in the `go-navigation` scenario.

const TIMEOUT = { timeout: 300_000 };

function askLinks({ harness, editor }: IGoLspSession): Promise<readonly ILink[]> {
    const document = editor.viewState.document;
    return getLinks(
        harness.languageFeatures.documentLinkProvider,
        editor,
        { uri: editor.uri.toString(), languageId: editor.languageId, versionId: document.versionId, document },
        CancellationTokenNone,
    );
}

describeStockGo("ExtensionHost — links of stock golang.go", (withGoFile) => {
    it('`import "fmt"` is a link on the path, with pkg.go.dev/fmt as its target', TIMEOUT, () =>
        withGoFile(async (session) => {
            const links = await askLinks(session);

            const path = session.at('"fmt"', 1);
            expect(links).toHaveLength(1);
            expect(links[0].range.start).toEqual({ line: path.line, character: path.character });
            expect(links[0].range.end).toEqual({ line: path.line, character: path.character + "fmt".length });
            expect(links[0].url).toMatch(/^https:\/\/pkg\.go\.dev\/fmt(\?|$)/);
            expect(session.clientCrashes()).toEqual([]);
        }),
    );

    it('"ui.navigation.importShortcut": "Definition" leaves the import without a link', TIMEOUT, () =>
        withGoFile(
            async (session) => {
                await expect(askLinks(session)).resolves.toEqual([]);
            },
            { "ui.navigation.importShortcut": "Definition" },
        ),
    );
});
