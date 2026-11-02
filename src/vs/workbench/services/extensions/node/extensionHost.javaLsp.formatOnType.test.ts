import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JDK_MISSING } from "../../../../../TestUtils/javaFixture.ts";
import { type IJavaSuite, openJavaSuite, waitForStandardServer } from "../../../../../TestUtils/javaHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { FormatOnTypeController } from "../../../../editor/contrib/format/browser/formatOnType.ts";

// Each trigger of `java.format.onType.enabled` on its own line of the buffer, seen on the frame. `editor.formatOnType`
// is off by default, as upstream: the controller here stands for a user who turned it on.

const TYPING = "Typing.java";
const TYPING_JAVA = `package demo;

public class Typing {
    void semicolon() {
        int x=1
    }

    void enter() {
        int y=2;
    }

    void brace() {
        if(true){
            int z=3;
    }
}
`;

async function open(configuration: Record<string, unknown>): Promise<IJavaSuite> {
    const suite = await openJavaSuite({ sources: { [TYPING]: TYPING_JAVA }, open: [TYPING], configuration });
    // The harness has no workbench services: the service's part is tested on its own.
    new FormatOnTypeController(suite.editorOf(TYPING), {
        providers: suite.harness.languageFeatures.onTypeFormattingEditProvider,
        isSettingEnabled: () => true,
    });
    await waitForStandardServer(suite, TYPING, 2, 15);
    return suite;
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: format on type", () => {
    describe("java.format.onType.enabled by default", () => {
        let suite: IJavaSuite;

        const typeAt = async (line: number, character: number, text: string, expected: string): Promise<void> => {
            const editor = suite.editorOf(TYPING);
            editor.viewState.selections = [createCursorSelection(line, character)];
            editor.typeText(text);
            await waitUntil("the format", () => suite.frame().includes(expected), 60_000);
        };

        beforeAll(async () => {
            suite = await open({});
        }, 400_000);

        afterAll(async () => {
            await suite.dispose();
        });

        it("`;` formats the statement", { timeout: 120_000 }, async () => {
            await typeAt(4, 15, ";", "int x = 1;");
        });

        it("Enter formats the line it leaves", { timeout: 120_000 }, async () => {
            await typeAt(8, 16, "\n", "int y = 2;");
        });

        it("`}` formats the block it closes", { timeout: 120_000 }, async () => {
            // Line 13 of the source, one lower after the Enter above.
            const text = suite.editorOf(TYPING).viewState.document.getLineContent(14);
            expect(text).toContain("int z=3;");
            await typeAt(14, text.length, "}", "int z = 3;");
        });
    });

    it(
        "with the setting off the server registers no provider and `;` leaves the text alone",
        { timeout: 450_000 },
        async () => {
            const suite = await open({ "java.format.onType.enabled": false });
            try {
                const editor = suite.editorOf(TYPING);
                editor.viewState.selections = [createCursorSelection(4, 15)];
                editor.typeText(";");
                expect(suite.harness.languageFeatures.onTypeFormattingEditProvider.has(editor)).toBe(false);
                expect(editor.viewState.document.getLineContent(4)).toBe("        int x=1;");
            } finally {
                await suite.dispose();
            }
        },
    );
});
