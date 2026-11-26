import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * The text `TextEditor.insertSnippet` leaves in the document must be what upstream's `SnippetParser` makes of the
 * template, session or no session (#967): snippet syntax never reaches the file.
 */
describe("ExtensionHost — TextEditor.insertSnippet, inserted text", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function insert(template: string): Promise<string> {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: "" },
            extensions: [extensionFixture("test.snippet", "insertSnippetExtension.cjs")],
        });
        harness = h;
        const pane = h.group.editorGroups.groups[0].getPane(0);
        expect(pane).toBeInstanceOf(TextEditorPane);
        await settle();

        await h.commandRegistry.execute("test.snippet.insert", template);
        await settle();

        return (pane as TextEditorPane).model.document.getText();
    }

    it("[api:TextEditor.insertSnippet] an escaped dollar, curly and backslash come out as plain characters", async () => {
        await expect(insert("\\$x \\} \\\\")).resolves.toBe("$x } \\");
    });

    it("[api:TextEditor.insertSnippet] an escaped curly inside a placeholder stays part of its text", async () => {
        await expect(insert("${1:a\\}b}")).resolves.toBe("a}b");
    });

    it("[api:TextEditor.insertSnippet] a nested placeholder leaves its text, not its syntax", async () => {
        await expect(insert("${1:foo ${2:bar}}")).resolves.toBe("foo bar");
    });

    it("[api:TextEditor.insertSnippet] a mirror starts with the text of its placeholder", async () => {
        await expect(insert("${1:x} ${1}")).resolves.toBe("x x");
    });
});
