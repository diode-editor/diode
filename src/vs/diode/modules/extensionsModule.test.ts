import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { REGISTRY_SCHEMA_VERSION } from "../../platform/extensionManagement/common/registryFormat.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { ExtensionPageActionsDIToken } from "../../workbench/contrib/extensions/browser/extensionPageActions.ts";
import {
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";

import { extensionsModule } from "./extensionsModule.ts";
import { createTestContainer } from "./testProfile.ts";

/** Перепутанный аргумент даёт рабочий контейнер и неверный список расширений. */

const HOST = { diode: "1.0.0", vscode: "1.90.0" };

function indexJson(entries: unknown[]): string {
    return JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: entries });
}

function entry(id: string, engines: Record<string, string>): unknown {
    const [publisher, name] = id.split(".");
    return {
        id,
        publisher,
        name,
        displayName: name,
        description: "",
        kind: "native",
        latest: { version: "1.0.0", engines },
    };
}

describe("extensionsModule", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    /** Токены магазина «отравлены»: перестань продовый модуль их перебивать — тест прошёл бы на дефолтах профиля. */
    function setup(options: { problems?: string[] } = {}): ReturnType<typeof createTestContainer>["container"] {
        const { container } = createTestContainer({
            environment: { registry: ws!.path("registry"), extensionsDir: ws!.path("extensions") },
        });
        const poison = (what: string) => (): never => {
            throw new Error(`${what} не перебит продовым модулем магазина`);
        };
        container.bind(ExtensionsWorkbenchServiceDIToken, poison("сервис магазина"));
        container.bind(ExtensionsComponentDIToken, poison("вьюлет магазина"));
        container.bind(ExtensionsEditorTargetDIToken, poison("шов открытия страницы"));
        container.bind(ExtensionPageActionsDIToken, poison("действия страницы"));
        container.use(extensionsModule, {
            host: HOST,
            onProblem: (message) => options.problems?.push(message),
        });
        return container;
    }

    it("сервис читает реестр по переданному адресу и состав активного профиля", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile(
            "registry/index.json",
            indexJson([entry("acme.tools", { vscode: "^1.0.0" }), entry("old.legacy", { vscode: "^99.0.0" })]),
        );
        ws.writeFile(
            "extensions/local.helper-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "helper", version: "0.1.0" }),
        );
        // На диске, но не в профиле окна (Default: `extensions/extensions.json`) — не видно.
        ws.writeFile(
            "extensions/local.other-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "other", version: "0.1.0" }),
        );
        ws.writeFile(
            "extensions/extensions.json",
            JSON.stringify([{ identifier: { id: "local.helper" }, version: "0.1.0" }]),
        );

        const service = setup().get(ExtensionsWorkbenchServiceDIToken);
        await service.ensureLoaded();

        expect(service.getEntries().map((e) => `${e.id}:${e.availability}`)).toEqual([
            // Совместимость считается по версиям сборки из того же биндинга.
            "acme.tools:available",
            "old.legacy:incompatible",
            "local.helper:installed",
        ]);
    });

    it("нечитаемый состав профиля — пустой список и ошибка в канал Extensions", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile(
            "extensions/local.helper-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "helper", version: "0.1.0" }),
        );
        ws.writeFile("extensions/extensions.json", "{");
        const entries: LogEntry[] = [];
        const logService = new LogService();
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const container = setup();
        container.bind(ILogServiceDIToken, () => logService);

        expect(container.get(ExtensionsWorkbenchServiceDIToken).getEntries()).toEqual([]);
        expect(entries.map((e) => [e.channel, e.message])).toEqual([
            ["extensions", `Failed to read profile extensions ${ws.path("extensions/extensions.json")}`],
        ]);
        expect(logService.getRegisteredChannels()).toContainEqual({ id: "extensions", label: "Extensions" });
    });

    it("диагностики парсера уходят в переданный onProblem", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile("registry/index.json", indexJson([entry("acme.tools", { vscode: "^1.0.0" }), { id: "broken" }]));
        const problems: string[] = [];

        await setup({ problems }).get(ExtensionsWorkbenchServiceDIToken).ensureLoaded();

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("skipping invalid entry");
    });

    it("страницу расширения открывает полоса редакторов", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        const container = setup();

        expect(container.get(ExtensionsEditorTargetDIToken)).toBe(container.get(EditorServiceDIToken));
    });

    it("вьюлет собирается из контейнера", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });

        expect(setup().get(ExtensionsComponentDIToken).view.id).toBe("extensionsView");
    });

    it("действия страницы ходят в тот же магазин, что и вьюлет", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile("registry/index.json", indexJson([]));
        const container = setup();

        // Удалять нечего — важно, что ответ пришёл от настоящего сервиса поверх
        // переданного каталога, а не от заглушки.
        await expect(container.get(ExtensionPageActionsDIToken).uninstall("acme.tools")).resolves.toEqual({
            ok: false,
            error: "Extension acme.tools is not installed",
        });
    });
});
