import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { builtinActions } from "./builtinActions.ts";

/**
 * Срез порядка палитры команд (F2). Без запроса палитра показывает команды в
 * порядке регистрации, а при равной оценке совпадения порядок решает ничью —
 * то есть порядок `builtinActions` виден пользователю. Срез делает эту
 * зависимость явной: перестановка развёрток фич краснит тест, и новый порядок
 * принимается осознанно. Эталон — `builtinActions.palette.slice.json` рядом;
 * пересобрать: `UPDATE_SLICE=1 npx vitest run <этот файл>`.
 */

const SLICE_URL = new URL("./builtinActions.palette.slice.json", import.meta.url);

describe("срез порядка палитры команд", () => {
    it("встроенные команды регистрируются в эталонном порядке", () => {
        const current = builtinActions.map((action) => action.id);
        if (process.env.UPDATE_SLICE === "1") writeFileSync(SLICE_URL, `${JSON.stringify(current, null, 4)}\n`);
        const reference = JSON.parse(readFileSync(SLICE_URL, "utf8")) as string[];
        expect(current.length).toBeGreaterThan(100);
        expect(current).toEqual(reference);
    });
});
