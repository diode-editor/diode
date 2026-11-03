import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideCompletions,
    provideInlineCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * A `SnippetString` from the builders (#1030) reaches the buffer not only through `insertSnippet`. Without a
 * snippet session these paths insert the template as text, and the text must be what VS Code inserts:
 * `appendText("}")` gives `}`, `appendText("\\")` gives `\`, not their escaped forms.
 */
describe("ExtensionHost — SnippetString builders outside insertSnippet (subprocess)", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(content: string) {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content },
            extensions: [extensionFixture("test.buildsSnippets", "buildsSnippets.cjs")],
        });
        harness = h;
        await settle();
        const uri = Uri.file(`${h.tmpDir}/main.txt`).toString();
        return { h, uri };
    }

    it("[api:SnippetString.appendText] a completion item built with the builders inserts the text unescaped", async () => {
        const { h, uri } = await setup("x");

        const { items } = await provideCompletions(h, {
            uri,
            languageId: "plaintext",
            versionId: documentVersion(h, uri),
            line: 0,
            character: 1,
        });

        expect(items.find((item) => item.label === "body")?.insertText).toBe("f() {}");
        expect(items.find((item) => item.label === "path")?.insertText).toBe("C:\\Users\\name");
    });

    it("[api:SnippetString.appendText] an inline completion built with the builders shows the text unescaped", async () => {
        const { h, uri } = await setup("x");

        const items = await provideInlineCompletions(
            h,
            {
                uri,
                languageId: "plaintext",
                versionId: documentVersion(h, uri),
                line: 0,
                character: 1,
                triggerKind: InlineCompletionTriggerKind.Automatic,
            },
            CancellationTokenNone,
        );

        expect(items.map((item) => item.insertText)).toEqual(["f() {}"]);
    });

    it("[api:SnippetString.appendText] a SnippetTextEdit built with the builders puts the text in the buffer unescaped", async () => {
        const { h } = await setup("\n");

        await expect(h.commandRegistry.execute("test.snippets.applyEdit")).resolves.toBe(true);
        await settle();

        expect(h.group.getActiveEditor()?.getText()).toBe("f() {}\n");
    });
});
