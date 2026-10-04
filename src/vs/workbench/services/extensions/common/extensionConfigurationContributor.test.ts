import { describe, expect, it } from "vitest";

import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { ExtensionConfigurationContributor } from "./extensionConfigurationContributor.ts";

function ext(id: string, properties: Record<string, unknown>): { id: string; manifest: object } {
    return { id, manifest: { name: id, contributes: { configuration: { properties } } } };
}

function recordingLogger(): ILogger & { warnings: string[] } {
    const warnings: string[] = [];
    return { ...NULL_LOGGER, warnings, warn: (message: string) => warnings.push(message) };
}

describe("ExtensionConfigurationContributor", () => {
    it("регистрирует contributes.configuration всех расширений, включая декларативные", () => {
        const registry = new ConfigurationRegistry();
        const extensions = [
            ext("acme.ruff", { "ruff.importStrategy": { default: "fromEnvironment" } }),
            // Без `main`: в host'е не регистрируется, но настройки у него есть.
            {
                id: "acme.theme",
                manifest: { contributes: { configuration: [{ properties: { "theme.x": { default: 1 } } }] } },
            },
            { id: "acme.bare", manifest: {} },
        ];

        new ExtensionConfigurationContributor(extensions, registry, () => ({})).apply();

        expect(registry.getDefaultConfiguration()).toEqual({
            ruff: { importStrategy: "fromEnvironment" },
            theme: { x: 1 },
        });
        expect(registry.getExtensionConfigurationProperties().get("theme.x")?.extensionId).toBe("acme.theme");
    });

    it("инъекции хоста — переопределения поверх манифестных дефолтов, в том числе чужих ключей", () => {
        const registry = new ConfigurationRegistry();
        const seen: string[] = [];
        // Инъекция первого расширения трогает ключ второго — переопределения
        // применяются после регистрации всех ключей.
        const extensions = [
            ext("acme.first", { "first.a": { default: 1 } }),
            ext("acme.second", { "second.b": { default: 2 } }),
        ];

        new ExtensionConfigurationContributor(extensions, registry, (e) => {
            seen.push(e.id);
            return e.id === "acme.first" ? { "second.b": 20, "injected.c": true } : {};
        }).apply();

        expect(seen).toEqual(["acme.first", "acme.second"]);
        expect(registry.getDefaultConfiguration()).toEqual({
            first: { a: 1 },
            second: { b: 20 },
            injected: { c: true },
        });
    });

    it("без логгера дубль ключа — тихий пропуск", () => {
        const registry = new ConfigurationRegistry();

        expect(() => {
            new ExtensionConfigurationContributor(
                [ext("one.ext", { "shared.k": { default: 1 } }), ext("two.ext", { "shared.k": { default: 2 } })],
                registry,
                () => ({}),
            ).apply();
        }).not.toThrow();
        expect(registry.getDefaultConfiguration()).toEqual({ shared: { k: 1 } });
    });

    it("дубль ключа — предупреждение в лог, первый владелец остаётся", () => {
        const registry = new ConfigurationRegistry();
        const logger = recordingLogger();

        new ExtensionConfigurationContributor(
            [ext("one.ext", { "shared.k": { default: 1 } }), ext("two.ext", { "shared.k": { default: 2 } })],
            registry,
            () => ({}),
            logger,
        ).apply();

        expect(registry.getDefaultConfiguration()).toEqual({ shared: { k: 1 } });
        expect(logger.warnings).toEqual([
            'two.ext: configuration key "shared.k" is already registered by one.ext, skipped',
        ]);
    });
});
