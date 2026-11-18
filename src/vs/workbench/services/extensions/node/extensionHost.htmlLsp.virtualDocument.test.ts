import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildHtmlLanguageFeatures,
    type IHtmlDocument,
    openHtmlDocument,
    until,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";

// The HTML client's selector covers every scheme, as upstream: an `.html` document from a content provider gets
// completion through `vscode.executeCompletionItemProvider` (what Angular's embedded templates rely on).

describe("ExtensionHost — built-in HTML language features: virtual documents", () => {
    let html: IHtmlDocument | undefined;

    beforeAll(buildHtmlLanguageFeatures, 120_000);

    afterEach(async () => {
        await html?.harness.dispose();
        html = undefined;
    });

    it("an html document of a content provider gets element completion", { timeout: 60_000 }, async () => {
        html = await openHtmlDocument("index.html", "\n", {
            extensions: [extensionFixture("test.virtualHtml", "providesHtmlVirtualDocument.cjs")],
        });
        const { harness } = html;
        await harness.host.activateByEvent("*");
        let answer = { languageId: "", labels: [] as string[] };
        await until("completion in the virtual document", async () => {
            answer = (await harness.commandRegistry.execute("fixture.completeVirtualHtml")) as typeof answer;
            return answer.labels.includes("div");
        });
        expect(answer.languageId).toBe("html");
        expect(answer.labels).toContain("dialog");
    });
});
