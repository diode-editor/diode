import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isSubmenuContribution, type MenuContribution } from "../../../platform/actions/common/iMenuContribution.ts";

import { MENU_CONTRIBUTIONS } from "./menuContributions.ts";

/**
 * Срез раскладки меню (F2, предохранитель разноса `builtinActions` по фичам).
 * Пункты одной группы с равным `order` сортируются по индексу вставки, то есть
 * по порядку экшенов в `builtinActions` — перестановка массива молча
 * переставила бы пункты меню. Эталон — `menuContributions.slice.json` рядом;
 * пересобрать от текущего кода: `UPDATE_SLICE=1 npx vitest run <этот файл>`.
 *
 * Формат: меню → группа → пункты в итоговом порядке (команда либо
 * `submenu:<id>`). Порядок самих групп задаёт их ключ, а не вставка, поэтому
 * группы перечислены по имени.
 */

const SLICE_URL = new URL("./menuContributions.slice.json", import.meta.url);

function itemId(item: MenuContribution): string {
    return isSubmenuContribution(item) ? `submenu:${item.submenu.id}` : item.command;
}

function menuSlice(items: readonly MenuContribution[]): Record<string, Record<string, string[]>> {
    const byMenu = new Map<string, Map<string, { id: string; order: number; index: number }[]>>();
    items.forEach((item, index) => {
        const groups = byMenu.get(item.menuId.id) ?? new Map<string, { id: string; order: number; index: number }[]>();
        byMenu.set(item.menuId.id, groups);
        const group = item.group ?? "";
        groups.set(group, [...(groups.get(group) ?? []), { id: itemId(item), order: item.order ?? 0, index }]);
    });
    const slice: Record<string, Record<string, string[]>> = {};
    for (const menuId of [...byMenu.keys()].sort()) {
        const groups = byMenu.get(menuId)!;
        slice[menuId] = Object.fromEntries(
            [...groups.keys()].sort().map((group) => [
                group,
                groups
                    .get(group)!
                    .sort((a, b) => a.order - b.order || a.index - b.index)
                    .map((entry) => entry.id),
            ]),
        );
    }
    return slice;
}

describe("срез раскладки меню", () => {
    it("пункты каждой группы каждого меню стоят в эталонном порядке", () => {
        const current = menuSlice(MENU_CONTRIBUTIONS);
        if (process.env.UPDATE_SLICE === "1") writeFileSync(SLICE_URL, `${JSON.stringify(current, null, 4)}\n`);
        const reference = JSON.parse(readFileSync(SLICE_URL, "utf8")) as typeof current;
        // Срез обязан быть содержательным: меню — десятки.
        expect(Object.keys(current).length).toBeGreaterThan(10);
        expect(current).toEqual(reference);
    });
});
