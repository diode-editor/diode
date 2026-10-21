import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff } from "../../../../../TestUtils/ruffFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction } from "../../../contrib/format/browser/formatActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

// Two badly formatted lines: formatting fixes both (ruff leaves quotes alone; the default
// style is double).
const MESSY_PY = 'x  =  1\nprint( "x" )\n';

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — formatting from the stock ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("formatDocument: edits from the real ruff formatter land in the buffer", { timeout: 240_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const mainPath = harness.writeFile("messy.py", MESSY_PY);
            const mainUri = Uri.file(mainPath).toString();
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // The client registers the formatting provider dynamically (client/registerCapability).
            const edits = await until("formatting edits from ruff", async () => {
                const found: readonly ITextEdit[] | null = await formatDocumentFor(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            expect(edits.length).toBeGreaterThan(0);

            const statusBar = {
                addEntry: () => ({ dispose: () => undefined }),
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, formatDocumentAction);

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe('x = 1\nprint("x")\n');
        } finally {
            await harness.dispose();
        }
    });

    it("range formatting: a ranged request uses the ruff rangeFormatting provider", { timeout: 240_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const mainPath = harness.writeFile("messy.py", MESSY_PY);
            const mainUri = Uri.file(mainPath).toString();
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // The range covers only the second line: edits must arrive
            // (ruff supports range formatting) and stay within it.
            const edits = await until("range formatting edits from ruff", async () => {
                const found: readonly ITextEdit[] | null = await formatDocumentFor(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    range: createRange(1, 0, 2, 0),
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            for (const edit of edits) {
                expect(edit.range.start.line).toBeGreaterThanOrEqual(1);
            }
        } finally {
            await harness.dispose();
        }
    });
});
