import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    type IInstalledBasedpyright,
    installBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff } from "../../../../../TestUtils/ruffFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// ДВА python-сервера разом — продовая конфигурация Python в Diode: basedpyright
// (типы) + ruff (линт/формат). Проверяются ровно места стыка: диагностики обеих
// DiagnosticCollection сливаются по одному файлу, а формат отдаёт ruff —
// у basedpyright формат-capability нет, «первый матчащий провайдер» не должен
// упереться в него.

// И ошибка типов (basedpyright: str в int), и криво отформатированное
// присваивание с неиспользуемым импортом (ruff: F401 + формат).
const DUO_PY = 'import sys\n\nreply: int  =  "hi"\n';

let ruff: IInstalledRuff;
let basedpyright: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — basedpyright + ruff одновременно", () => {
    beforeAll(async () => {
        [ruff, basedpyright] = await Promise.all([installRuff(), installBasedpyright()]);
    }, 180_000);

    afterAll(() => {
        ruff.dispose();
        basedpyright.dispose();
    });

    it("диагностики обоих серверов сливаются, формат отдаёт ruff", { timeout: 240_000 }, async () => {
        const published: { owner: string; resource: string; markers: readonly WireMarker[] }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            diagnosticsSink: (owner, resource, markers) => published.push({ owner, resource, markers }),
            extensions: [ruff.registration, basedpyright.registration],
        });
        try {
            const duoPath = harness.writeFile("duo.py", DUO_PY);
            const duoUri = Uri.file(duoPath).toString();
            harness.group.openFile(duoPath);
            await harness.host.activateByEvent("onLanguage:python");
            expect(harness.host.hasExtension("charliermarsh.ruff")).toBe(true);
            expect(harness.host.hasExtension("detachhead.basedpyright")).toBe(true);

            // Последний снапшот маркеров файла от КАЖДОГО владельца коллекции.
            const latestByOwner = (predicate: (m: WireMarker) => boolean): WireMarker | undefined => {
                for (const p of [...published].reverse()) {
                    if (p.resource !== duoUri) continue;
                    const hit = p.markers.find(predicate);
                    if (hit !== undefined) return hit;
                }
                return undefined;
            };

            // Оба сервера дошли до одного файла: F401 от ruff, ошибка типов от
            // basedpyright (его холодный старт — десятки секунд, ruff давно готов).
            await until("F401 от ruff", () =>
                Promise.resolve(latestByOwner((m) => /F401|unused/.test(`${m.code ?? ""} ${m.message}`)) ?? null),
            );
            await until("ошибка типов от basedpyright", () =>
                Promise.resolve(latestByOwner((m) => m.message.includes("is not assignable")) ?? null),
            );

            // Формат: единственный формат-провайдер — ruff; правки чинят присваивание.
            const edits = await until("formatting edits при двух серверах", async () => {
                const source = harness.group.formattingSource;
                if (source === undefined) return null;
                const found: readonly ITextEdit[] | null = await source({
                    uri: duoUri,
                    languageId: "python",
                    text: DUO_PY,
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            const patched = edits.some((e) => e.text.includes('reply: int = "hi"'));
            expect(patched).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
