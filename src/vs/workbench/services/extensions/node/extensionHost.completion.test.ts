import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

const REQ = {
    uri: Uri.file("/proj/.editorconfig").toString(),
    languageId: "editorconfig",
    text: "ind",
    line: 0,
    character: 3,
};

describe("ExtensionHost — completion bridge (subprocess)", () => {
    it("provideCompletionItems возвращает элементы провайдера, item.command исполняется через bridge", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture("test.providesCompletion", "providesCompletion.cjs")],
        });
        try {
            await settle();

            // Через group.completionSource (wiring харнесса) — как это делает ядро.
            const { items } = await harness.group.completionSource!(REQ);
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
            const result = await harness.host.provideCompletionItems({ ...REQ, languageId: "typescript" });
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
            const result = await harness.host.provideCompletionItems({
                uri: Uri.file("/proj/main.ts").toString(),
                languageId: "typescript",
                text: "x",
                line: 0,
                character: 1,
            });
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            await harness.dispose();
        }
    });
});
