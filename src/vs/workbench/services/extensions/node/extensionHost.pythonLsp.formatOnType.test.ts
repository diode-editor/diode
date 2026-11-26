import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    type IInstalledBasedpyright,
    installBasedpyright,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IPythonSession, withPythonFiles } from "../../../../../TestUtils/pythonSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { FormatOnTypeService } from "../../../contrib/format/browser/formatOnTypeService.ts";

const FORMATTED = 'print(f"{';
const UNTOUCHED = 'print("{';

let installed: IInstalledBasedpyright;

interface ITyped {
    /** The line once the answer to the typing has been applied. */
    readonly line: string;
    /** How many edits the server offers at that place, asked directly. */
    readonly offered: number;
}

interface IFormatSession extends IPythonSession {
    /** Types `print("{` into an emptied buffer: an open f-string on a line above would swallow the new one. */
    type(): Promise<ITyped>;
    /** Types until the line comes out as asked: a setting and the first analysis arrive asynchronously. */
    typeUntil(line: string): Promise<void>;
}

/**
 * The real service over the extension's configuration, whose registry holds the manifest's `configurationDefaults`.
 * After the typing the provider is asked at the same place: answers come in order, so its reply means the reply to
 * the typing has been applied too.
 */
async function withFormatOnType(run: (session: IFormatSession) => Promise<void>): Promise<void> {
    await withPythonFiles(installed, { "main.py": "" }, async (session) => {
        const { harness } = session;
        const service = new FormatOnTypeService(
            harness.group,
            harness.languageFeatures,
            harness.extensionConfiguration,
        );
        try {
            const editor = session.activeEditor();
            const provider = await until(
                "the on-type provider",
                () => harness.languageFeatures.onTypeFormattingEditProvider.ordered(editor).at(0) ?? null,
            );
            expect(provider.triggerCharacters).toEqual(["{"]);
            const type = async (): Promise<ITyped> => {
                const { document } = editor.viewState;
                const lastLine = document.lineCount - 1;
                editor.applyExternalEdits(
                    [createTextEdit(createRange(0, 0, lastLine, document.getLineContent(lastLine).length), "")],
                    "clear",
                );
                editor.viewState.selections = [createCursorSelection(0, 0)];
                editor.typeText(UNTOUCHED);
                const edits = await provider.provideOnTypeFormattingEdits(
                    {
                        uri: editor.uri.toString(),
                        languageId: "python",
                        versionId: editor.viewState.document.versionId,
                        position: editor.viewState.selections[0].active,
                        ch: "{",
                        tabSize: 4,
                        insertSpaces: true,
                    },
                    CancellationTokenNone,
                );
                return { line: document.getLineContent(0), offered: edits.length };
            };
            await run({
                ...session,
                type,
                typeUntil: async (line) => {
                    await until(`the line ${line}`, async () => ((await type()).line === line ? true : null));
                },
            });
        } finally {
            service.dispose();
        }
    });
}

describe.skipIf(MARKETPLACE_OFFLINE)(
    "ExtensionHost — format on type from the stock basedpyright",
    { timeout: 240_000 },
    () => {
        beforeAll(async () => {
            installed = await installBasedpyright();
        }, 120_000);

        afterAll(() => {
            installed.dispose();
        });

        it("the manifest turns it on for python: `{` in a string puts an f before the quote, on the frame", async () => {
            await withFormatOnType(async ({ activeEditor, typeUntil, frameHas }) => {
                await typeUntil(FORMATTED);
                await frameHas(FORMATTED);
                // The caret moved along with the edit: the next character follows the brace.
                const editor = activeEditor();
                expect(editor.viewState.selections[0].active.character).toBe(FORMATTED.length);
                editor.undo();
                expect(editor.viewState.document.getLineContent(0)).toBe(UNTOUCHED);
            });
        });

        it("basedpyright.analysis.autoFormatStrings: false stops it, true brings it back", async () => {
            await withFormatOnType(async ({ harness, typeUntil }) => {
                await typeUntil(FORMATTED);
                await harness.extensionConfiguration.updateValue("basedpyright.analysis.autoFormatStrings", false);
                await typeUntil(UNTOUCHED);
                await harness.extensionConfiguration.updateValue("basedpyright.analysis.autoFormatStrings", true);
                await typeUntil(FORMATTED);
            });
        });

        // The server keeps offering the edit: the setting works on our side, before the request.
        it("editor.formatOnType: false in [python] stops it though the server offers the edit", async () => {
            await withFormatOnType(async ({ harness, type, typeUntil }) => {
                await typeUntil(FORMATTED);
                await harness.extensionConfiguration.updateValue("[python]", { "editor.formatOnType": false });
                expect(await type()).toEqual({ line: UNTOUCHED, offered: 1 });
            });
        });
    },
);
