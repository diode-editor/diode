import { describe, expect, it } from "vitest";

import { Point } from "@tuidom/core/common/geometryPromitives";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { buildExtensionRow, buildGroupRow, describeExtensionRow, type IExtensionRowStyles } from "./extensionRows.ts";

const STYLES: IExtensionRowStyles = {
    dimFg: "descriptionForeground",
    updateFg: "textLink.foreground",
    warningFg: "editorWarning.foreground",
};

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        needsReload: false,
        ...overrides,
    };
}

describe("describeExtensionRow", () => {
    it("не установлено — имя и версия реестра, без бейджа", () => {
        const row = describeExtensionRow(entry());
        expect(row.text).toBe("Acme Tools  1.0.0");
        expect(row.badge).toBeNull();
        // Спан версии указывает ровно на неё — по нему строка красит приглушённым.
        expect(row.version).toEqual({ start: 12, length: 5 });
        expect(row.text.slice(row.version.start, row.version.start + row.version.length)).toBe("1.0.0");
    });

    it("установлена последняя версия — бейдж Installed", () => {
        const row = describeExtensionRow(entry({ installedVersion: "1.0.0", availability: "installed" }));
        expect(row.text).toBe("Acme Tools  1.0.0  Installed");
        expect(row.badge?.kind).toBe("installed");
    });

    it("есть обновление — бейдж называет версию, до которой обновит установка", () => {
        const row = describeExtensionRow(entry({ installedVersion: "0.9.0", availability: "outdated" }));
        expect(row.text).toBe("Acme Tools  0.9.0  Update 1.0.0");
        expect(row.badge).toEqual({ start: 19, length: 12, kind: "update" });
        expect(row.text.slice(row.badge!.start, row.badge!.start + row.badge!.length)).toBe("Update 1.0.0");
    });

    it("ждём перезагрузки — бейдж говорит об этом раньше всего остального", () => {
        // Установленную версию видно, но работать она начнёт только после
        // перезагрузки окна — это и есть главное про такую запись.
        const row = describeExtensionRow(entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true }));
        expect(row.text).toBe("Acme Tools  1.0.0  Reload");
        expect(row.badge?.kind).toBe("reload");
    });

    it("несовместимо — бейдж вместо обновления, даже если версия старая", () => {
        const row = describeExtensionRow(entry({ installedVersion: "0.9.0", availability: "incompatible" }));
        expect(row.text).toBe("Acme Tools  0.9.0  Incompatible");
        expect(row.badge?.kind).toBe("incompatible");
    });

    it("установлено мимо магазина — бейдж Installed без обновления", () => {
        const row = describeExtensionRow(
            entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" }),
        );
        expect(row.text).toBe("Acme Tools  0.1.0  Installed");
    });

    it("версии нет вовсе — строка остаётся именем", () => {
        const row = describeExtensionRow(entry({ latestVersion: null, installedVersion: null }));
        expect(row.text).toBe("Acme Tools");
        expect(row.version.length).toBe(0);
    });
});

describe("строки списка", () => {
    it("строка несёт свой id и текст раскладки", () => {
        const row = buildExtensionRow("row-1", entry(), STYLES);
        expect(row.id).toBe("row-1");
        expect(row.getText()).toBe("Acme Tools  1.0.0");
    });

    it("каждый вид бейджа красится своим цветом", () => {
        const fgOfBadge = (e: IExtensionListEntry): number => {
            const row = buildExtensionRow("row-1", e, STYLES);
            const screen = renderElement(row, 40, 1, { themeVars: true });
            return screen.getFgAt(new Point(describeExtensionRow(e).badge!.start, 0));
        };

        const installed = fgOfBadge(entry({ installedVersion: "1.0.0", availability: "installed" }));
        const update = fgOfBadge(entry({ installedVersion: "0.9.0", availability: "outdated" }));
        const incompatible = fgOfBadge(entry({ availability: "incompatible" }));

        expect(new Set([installed, update, incompatible]).size).toBe(3);
    });

    it("подсветка не растекается за спан версии", () => {
        const entryWithBadge = entry({ availability: "incompatible" });
        const row = buildExtensionRow("row-1", entryWithBadge, STYLES);
        const screen = renderElement(row, 40, 1, { themeVars: true });
        const layout = describeExtensionRow(entryWithBadge);

        // Пробел сразу за версией — цвета строки, а не приглушённый.
        const afterVersion = layout.version.start + layout.version.length;
        expect(screen.getFgAt(new Point(afterVersion, 0))).toBe(screen.getFgAt(new Point(0, 0)));
    });

    it("имя, версия и бейдж покрашены по-разному — это видно в кадре", () => {
        const row = buildExtensionRow("row-1", entry({ availability: "incompatible" }), STYLES);
        const screen = renderElement(row, 40, 1, { themeVars: true });
        const layout = describeExtensionRow(entry({ availability: "incompatible" }));

        expect(screen.screenToString()).toContain("Incompatible");
        const nameFg = screen.getFgAt(new Point(0, 0));
        const versionFg = screen.getFgAt(new Point(layout.version.start, 0));
        const badgeFg = screen.getFgAt(new Point(layout.badge!.start, 0));
        expect(versionFg).not.toBe(nameFg);
        expect(badgeFg).not.toBe(nameFg);
        expect(badgeFg).not.toBe(versionFg);
    });

    it("заголовок группы — приглушённая строка со своим id", () => {
        const row = buildGroupRow("group-1", "MARKETPLACE", "descriptionForeground");
        expect(row.id).toBe("group-1");
        expect(row.getText()).toBe("MARKETPLACE");

        // Приглушённый цвет — не унаследованный: заголовок группы тусклее записей.
        const groupFg = renderElement(row, 20, 1, { themeVars: true }).getFgAt(new Point(0, 0));
        const entryFg = renderElement(buildExtensionRow("row-1", entry(), STYLES), 20, 1, {
            themeVars: true,
        }).getFgAt(new Point(0, 0));
        expect(groupFg).not.toBe(entryFg);
    });
});
