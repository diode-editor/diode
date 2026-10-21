import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection, selectionToRange } from "../../../../editor/common/core/iSelection.ts";
import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";

// Only the language configuration (the harness has no language extensions) and settings are faked.

const CONFIGURATION: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    brackets: [
        ["{", "}"],
        ["(", ")"],
    ],
};
const CONTENT = "fn {\n  call(fooBar)\n}\n";

describe("Expand / Shrink Selection — commands and keybindings", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(settings: Record<string, unknown> = {}): void {
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("main.ts"),
            focusEditor: true,
            configurationService: new InMemoryConfigurationService(undefined, settings),
            containerOverrides: (container) => {
                container.bind(LanguageConfigurationServiceDIToken, () => ({
                    ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
                    get: () => CONFIGURATION,
                    ensureLoaded: () => Promise.resolve(CONFIGURATION),
                }));
            },
        });
        h.activeEditor().viewState.selections = [createCursorSelection(1, 13)];
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-smart-select-", files: { "main.ts": CONTENT } });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const selected = (): string => {
        const { viewState } = h.activeEditor();
        return viewState.document.getTextInRange(selectionToRange(viewState.selections[0]));
    };

    async function press(key: string, times = 1): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < times; i++) {
            h.testApp.sendKey(key);
            await settle();
            seen.push(selected());
        }
        return seen;
    }

    it("Shift+Alt+→ expands step by step, Shift+Alt+← shrinks back", async () => {
        boot();
        expect(await press("Shift+Alt+ArrowRight", 7)).toEqual([
            "Bar",
            "fooBar",
            "(fooBar)",
            "call(fooBar)",
            "  call(fooBar)",
            "\n  call(fooBar)\n",
            "{\n  call(fooBar)\n}",
        ]);
        expect(await press("Shift+Alt+ArrowLeft", 2)).toEqual(["\n  call(fooBar)\n", "  call(fooBar)"]);
    });

    it("editor.smartSelect.* settings turn off subword and line steps", async () => {
        boot({
            "editor.smartSelect.selectSubwords": false,
            "editor.smartSelect.selectLeadingAndTrailingWhitespace": false,
        });
        expect(await press("Shift+Alt+ArrowRight", 3)).toEqual(["fooBar", "(fooBar)", "\n  call(fooBar)\n"]);
    });

    it("settings are read with the language section", async () => {
        boot({
            "[plaintext]": {
                "editor.smartSelect.selectSubwords": false,
                "editor.smartSelect.selectLeadingAndTrailingWhitespace": false,
            },
        });
        expect(h.activeEditor().viewState.document.languageId).toBe("plaintext");
        expect(await press("Shift+Alt+ArrowRight", 3)).toEqual(["fooBar", "(fooBar)", "\n  call(fooBar)\n"]);
    });
});
