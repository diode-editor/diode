import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    installBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
    type IInstalledBasedpyright,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";

// Автодополнение поверх настоящего стороннего basedpyright.vsix (см.
// basedpyrightFixture): стоковый конвертер клиента на каждый ответ делает
// `new code.CompletionList(...)`, resolve догружает документацию — обе точки
// исполняются чужим кодом и проверяются только сквозняком.

const MAIN_PY = 'text = "hi"\ntext.\n';

let installed: IInstalledBasedpyright;

// Vsix приезжает из магазина (см. basedpyrightFixture.ts) — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — completion от стокового basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("члены str после точки доезжают до ядра, resolve отдаёт документацию", { timeout: 240_000 }, async () => {
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [installed.registration],
        });
        try {
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            const completionAt = async (line: number, character: number): Promise<readonly ICoreCompletionItem[]> => {
                const source = harness.group.completionSource;
                if (source === undefined) return [];
                const result = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MAIN_PY,
                    line,
                    character,
                    triggerKind: CompletionTriggerKind.TriggerCharacter,
                    triggerCharacter: ".",
                });
                return result.items;
            };

            // Каретка сразу после `text.` — ждём членов str из typeshed-стабов.
            const items = await until("completion после `text.`", async () => {
                const found = await completionAt(1, 5);
                return found.length > 0 ? found : null;
            });

            const labels = items.map((item) => item.label);
            expect(labels).toContain("upper");
            expect(labels).toContain("startswith");

            // Документация приходит только по resolve (контракт resolveSupport).
            const upper = items.find((item) => item.label === "upper");
            expect(upper?.id).toBeDefined();
            const resolved = await until("resolve пункта upper", async () => {
                const found = await harness.group.completionResolver!(upper!.id!);
                return found?.detail !== undefined || found?.documentation !== undefined ? found : null;
            });
            // Текст, которого нет в буфере: сигнатура/докстринг str.upper из стабов.
            expect(`${resolved?.detail ?? ""}\n${resolved?.documentation ?? ""}`).toContain("upper");

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
