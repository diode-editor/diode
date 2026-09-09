import { describe, expect, it } from "vitest";

import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { describeExtensionButtons } from "./extensionPageButtons.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        needsReload: false,
        ...overrides,
    };
}

const IDLE = { busy: false, needsReload: false };

describe("describeExtensionButtons", () => {
    it("не установлено — одна кнопка Install", () => {
        expect(describeExtensionButtons(entry(), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: true },
        ]);
    });

    it("установлена последняя версия — только удаление", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("есть версия новее — кнопка обновления называет её и стоит перед удалением", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "update", label: "Update to 1.0.0", enabled: true },
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("несовместимое не ставится: кнопка видна, но выключена", () => {
        expect(describeExtensionButtons(entry({ availability: "incompatible" }), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: false },
        ]);
    });

    it("несовместимое установленное можно только удалить — обновлять некуда", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "incompatible" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("ни в реестре, ни на диске — действий нет: ставить нечего", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: null });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([]);
    });

    it("установлено мимо магазина — только удаление", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("после установки первой идёт перезагрузка окна — это следующий шаг пользователя", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, { busy: false, needsReload: true })).toEqual([
            { kind: "reload", label: "Reload Window", enabled: true },
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("во время операции гаснут все кнопки, включая перезагрузку", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const buttons = describeExtensionButtons(entryValue, { busy: true, needsReload: true });

        expect(buttons.map((b) => b.kind)).toEqual(["reload", "update", "uninstall"]);
        expect(buttons.every((b) => !b.enabled)).toBe(true);
    });
});
