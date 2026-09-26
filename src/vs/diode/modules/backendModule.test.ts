import { describe, expect, it } from "vitest";

import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import { InMemoryClipboard } from "../../platform/clipboard/common/inMemoryClipboard.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import type { IExternalOpener } from "../../platform/opener/common/iExternalOpener.ts";
import { ExternalOpenerDIToken } from "../../platform/opener/common/iExternalOpener.ts";
import { ClipboardDIToken, FileClipboardDIToken } from "../../workbench/common/coreTokens.ts";

import { backendModule, backendModuleDefault, NULL_EXTERNAL_OPENER } from "./backendModule.ts";

// Внешние интеграции подключает модуль, а не сам сервис: если проводка врёт,
// `env.clipboard` расширения уедет не в тот карман, а `env.openExternal` —
// не тому открывателю. Тестом закрываем именно выбор реализации.

describe("NULL_EXTERNAL_OPENER", () => {
    it("ничего не открывает — это и есть его работа", async () => {
        await expect(NULL_EXTERNAL_OPENER.openExternal("https://example.com")).resolves.toBe(false);
    });
});

describe("backendModule", () => {
    it("буфер обмена отдаётся тот, что передали", () => {
        const clipboard = new InMemoryClipboard();
        const container = new Container().use(backendModule, { clipboard });
        expect(container.get(ClipboardDIToken)).toBe(clipboard);
        expect(container.get(FileClipboardDIToken)).toBeDefined();
    });

    it("открыватель отдаётся тот, что передали", () => {
        const externalOpener: IExternalOpener = { openExternal: () => Promise.resolve(true) };
        const container = new Container().use(backendModule, {
            clipboard: new InMemoryClipboard() as IClipboard,
            externalOpener,
        });
        expect(container.get(ExternalOpenerDIToken)).toBe(externalOpener);
    });

    it("открывателя не передали — никто ничего не открывает (headless, тесты)", () => {
        const container = new Container().use(backendModule, { clipboard: new InMemoryClipboard() });
        expect(container.get(ExternalOpenerDIToken)).toBe(NULL_EXTERNAL_OPENER);
    });

    it("один и тот же экземпляр на все резолвы — открыватель не пересоздаётся", () => {
        const container = new Container().use(backendModule, { clipboard: new InMemoryClipboard() });
        expect(container.get(ExternalOpenerDIToken)).toBe(container.get(ExternalOpenerDIToken));
    });
});

describe("backendModuleDefault", () => {
    it("умолчание для тестов: in-memory буфер и открыватель, который не открывает", () => {
        const container = new Container().use(backendModuleDefault);
        expect(container.get(ClipboardDIToken)).toBeInstanceOf(InMemoryClipboard);
        expect(container.get(ExternalOpenerDIToken)).toBe(NULL_EXTERNAL_OPENER);
    });
});
