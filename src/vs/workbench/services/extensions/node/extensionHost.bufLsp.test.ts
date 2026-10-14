import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    BUF_ID,
    ensureBufCli,
    type IInstalledBuf,
    installBuf,
    MAIN_PROTO,
    PROTO_LANGUAGE_SERVICE,
    UNFORMATTED_PROTO,
} from "../../../../../TestUtils/bufFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Protocol Buffers «как у пользователя»: НАСТОЯЩИЙ сторонний vsix
// bufbuild.vscode-buf из магазина, установленный штатным installVsix, на
// настоящем ext-host subprocess'е, и настоящий `buf lsp serve`. Сьют держит,
// что расширение активируется по workspaceContains, поднимает сервер и его
// функции доезжают до ядра: диагностики, hover, F12, автодополнение,
// форматирование.

let installed: IInstalledBuf;
let bufCli: string;

// Vsix приезжает из магазина, бинарь buf — с GitHub (см. bufFixture.ts) — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый bufbuild.vscode-buf (buf LSP, сквозняк)", () => {
    beforeAll(async () => {
        [installed, bufCli] = await Promise.all([installBuf(), ensureBufCli()]);
        expect(installed.registration.id).toBe(BUF_ID);
    }, 180_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "активация без ошибок; диагностика, hover, F12, автодополнение и форматирование от buf",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: PROTO_LANGUAGE_SERVICE,
                activateEvents: [],
                configuration: { buf: { commandLine: { path: bufCli } } },
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                const mainPath = harness.writeFile("demo.proto", MAIN_PROTO);
                const mainUri = Uri.file(mainPath).toString();
                const pointPath = harness.writeFile("point.proto", UNFORMATTED_PROTO);
                const pointUri = Uri.file(pointPath).toString();
                harness.group.openFile(pointPath);
                harness.group.openFile(mainPath);
                // Манифест активирует расширение по `workspaceContains:**/*.proto` —
                // тем же обходом воркспейса, что приложение на старте.
                await harness.host.activateByWorkspaceContains();
                expect(harness.host.hasExtension(BUF_ID)).toBe(true);

                // Диагностика от НАСТОЯЩЕГО buf — сигнал готовности сервера. Импорт
                // well-known типа ошибки не даёт: buf знает их без настройки.
                const unknown = await until("диагностика Usr", () => {
                    const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                    return Promise.resolve(markers.find((m) => m.message.includes("`Usr`")) ?? null);
                });
                expect(unknown.range.start.line).toBe(10);
                const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                expect(markers.filter((m) => m.message.includes("timestamp"))).toEqual([]);

                const at = (uri: string, line: number, character: number) => ({
                    uri,
                    languageId: "proto",
                    versionId: documentVersion(harness, uri),
                    line,
                    character,
                });

                // Hover над `User` в rpc — doc-комментарий сообщения.
                const hovers = await provideHovers(harness, at(mainUri, 15, 11));
                expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("A user of the demo service.");

                // F12 с `User` в rpc — на имя в `message User`.
                const definitions = await provideDefinitions(harness, at(mainUri, 15, 11));
                expect(definitions).toEqual([expect.objectContaining({ uri: mainUri })]);
                expect(definitions[0]?.range.start).toEqual({ line: 6, character: 8 });

                // Автодополнение на пустой строке тела сообщения — типы полей.
                const completions = await provideCompletions(harness, at(mainUri, 11, 2));
                const labels = completions.items.map((item) => item.label);
                expect(labels).toContain("User");
                expect(labels).toContain("google.protobuf.Timestamp");

                // Format Document на втором файле — отступы и пробелы как у `buf format`.
                const edits = await formatDocumentFor(harness, {
                    uri: pointUri,
                    languageId: "proto",
                    versionId: documentVersion(harness, pointUri),
                    tabSize: 2,
                    insertSpaces: true,
                });
                const formatted = (edits ?? []).map((edit) => edit.text).join("");
                expect(formatted).toContain("message Point {\n  int32 x = 1;\n}");

                // Конвертеры стокового клиента не падали молча (конвенция TS-сьютов).
                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
