import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICompletionRequest } from "../../../../editor/common/languages/iCompletionSource.ts";

/** Запрос по открытому в харнессе `.editorconfig` (`ind|`) — с его текущей версией. */
function requestIn(harness: IExtensionHarness): ICompletionRequest {
    const uri = Uri.file(`${harness.tmpDir}/.editorconfig`).toString();
    return { uri, languageId: "editorconfig", versionId: documentVersion(harness, uri), line: 0, character: 3 };
}

describe("ExtensionHost — completion bridge (subprocess)", () => {
    it("provideCompletionItems возвращает элементы провайдера, item.command исполняется через bridge", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture("test.providesCompletion", "providesCompletion.cjs")],
        });
        try {
            await settle();

            // Через group.completionSource (wiring харнесса) — как это делает ядро.
            const { items } = await provideCompletions(harness, requestIn(harness));
            expect(items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);

            const style = items.find((i) => i.label === "indent_style");
            expect(style?.insertText).toBe("indent_style"); // fallback на label
            expect(style?.detail).toBe("EditorConfig");
            expect(style?.command?.command).toBe("editorconfig._triggerSuggestAfterDelay");

            // item.command доезжает через commands bridge и правит активный редактор.
            expect(harness.commandRegistry.has("editorconfig._triggerSuggestAfterDelay")).toBe(true);
            await harness.commandRegistry.execute(style!.command!.command);
            await settle();
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(6);
        } finally {
            await harness.dispose();
        }
    });

    it("селектор другого языка → пустой результат", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture("test.providesCompletion", "providesCompletion.cjs")],
        });
        try {
            await settle();
            const result = await provideCompletions(harness, { ...requestIn(harness), languageId: "typescript" });
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            await harness.dispose();
        }
    });

    it("без completion-провайдеров (нет расширений) → [] без RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            const uri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const result = await provideCompletions(harness, {
                uri,
                languageId: "typescript",
                versionId: documentVersion(harness, uri),
                line: 0,
                character: 1,
            });
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            await harness.dispose();
        }
    });
});
