import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { REGISTRY_SCHEMA_VERSION } from "../../platform/extensionManagement/common/registryFormat.ts";
import {
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";

import { extensionsModule } from "./extensionsModule.ts";
import { createTestContainer } from "./testProfile.ts";

/**
 * Проводка магазина в DI: продовый модуль поверх тестового контейнера. Проверяем
 * не «биндинги объявлены», а что через них доезжают настоящие параметры —
 * адрес реестра, каталог установленного и версии сборки: перепутанный аргумент
 * даёт рабочий контейнер и неверный список расширений.
 */

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

    /**
     * Контейнер тестового профиля с продовой проводкой магазина поверх. Токены
     * магазина заранее «отравлены»: если продовый модуль перестанет их
     * перебивать, резолв упадёт — иначе тест зелёный на дефолтных биндингах
     * тестового профиля и ничего не проверяет.
     */
    function setup(options: { problems?: string[] } = {}): ReturnType<typeof createTestContainer>["container"] {
        const { container } = createTestContainer();
        const poison = (what: string) => (): never => {
            throw new Error(`${what} не перебит продовым модулем магазина`);
        };
        container.bind(ExtensionsWorkbenchServiceDIToken, poison("сервис магазина"));
        container.bind(ExtensionsComponentDIToken, poison("вьюлет магазина"));
        container.bind(ExtensionsEditorTargetDIToken, poison("шов открытия страницы"));
        container.use(extensionsModule, {
            registry: ws!.path("registry"),
            extensionsDir: ws!.path("extensions"),
            host: HOST,
            onProblem: (message) => options.problems?.push(message),
        });
        return container;
    }

    it("сервис читает реестр по переданному адресу и каталог установленного", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile(
            "registry/index.json",
            indexJson([entry("acme.tools", { vscode: "^1.0.0" }), entry("old.legacy", { vscode: "^99.0.0" })]),
        );
        ws.writeFile(
            "extensions/local.helper-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "helper", version: "0.1.0" }),
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
});
