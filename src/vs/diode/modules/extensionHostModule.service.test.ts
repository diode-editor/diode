import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import type { IExtension } from "../../platform/extensions/common/iExtension.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import { ExtensionServiceDIToken } from "../../workbench/services/extensions/common/extensions.ts";
import { LanguageRegistry } from "../../workbench/services/language/common/languageRegistry.ts";

import { extensionHostModule } from "./extensionHostModule.ts";

/** Встроенное расширение, исходник которого не читается, — повод для лога регистрации. */
const BROKEN_BUILTIN: IExtension = {
    id: "acme.broken",
    location: "extensions/broken/",
    isBuiltin: true,
    manifest: { name: "broken", publisher: "acme", version: "1.0.0", engines: { vscode: "*" }, main: "out/e.cjs" },
};

/**
 * Проводка сервиса расширений: продовый модуль поверх тестового харнесса.
 * Субпроцесс не поднимается — у набора нет расширений с событиями активации.
 */
describe("extensionHostModule — сервис расширений", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let entries: LogEntry[];

    beforeEach(() => {
        ws = createTempWorkspace({ files: { "a.json": "{}\n", "b.txt": "b\n" } });
        entries = [];
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const dir = path.join(tmpdir(), "diode-exthost-service-test");
        const languages = new LanguageRegistry();
        h = createAppTestHarness({
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                // Настоящий реестр языков: он и шлёт «языку нужны фичи».
                container.bind(LanguageServiceDIToken, () => languages);
                container.use(extensionHostModule, {
                    extensions: [BROKEN_BUILTIN],
                    registration: {
                        userPrefix: "UserExtensions/",
                        userExtensionsDir: dir,
                        readBuiltinSource: () => Promise.reject(new Error("no such asset")),
                    },
                });
            },
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("сервис получает набор из контекста модуля", () => {
        expect(h.container.get(ExtensionServiceDIToken).extensions).toEqual([BROKEN_BUILTIN]);
    });

    it("язык, впервые понадобившийся модели, просит onLanguage:<id> и голое onLanguage — один раз на язык", () => {
        const service = h.container.get(ExtensionServiceDIToken);
        const activate = vi.spyOn(service, "activateByEvent");

        h.workbench.openFile(ws.path("a.json"));
        // Реестр без языковых паков знает только plaintext.
        expect(activate.mock.calls).toEqual([["onLanguage:plaintext"], ["onLanguage"]]);

        activate.mockClear();
        h.workbench.openFile(ws.path("b.txt"));
        expect(activate).not.toHaveBeenCalled();

        h.container.get(EditorServiceDIToken).getActiveEditor()?.setLanguage("markdown");
        expect(activate.mock.calls).toEqual([["onLanguage:markdown"], ["onLanguage"]]);
    });

    it("сбой регистрации пишется в канал extensions", async () => {
        await h.container.get(ExtensionServiceDIToken).start();

        const entry = entries.find((e) => e.message.includes("failed to register"));
        expect(entry?.channel).toBe("extensions");
        expect(entry?.message).toBe("acme.broken: failed to register (builtin)");
    });
});
