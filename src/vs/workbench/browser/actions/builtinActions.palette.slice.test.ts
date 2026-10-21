import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORKBENCH_ACTIONS } from "../../workbench.common.main.ts";

/**
 * Без запроса палитра показывает команды в порядке регистрации, и при равной
 * оценке он же решает ничью — порядок `WORKBENCH_ACTIONS` виден пользователю.
 * Пересобрать эталон: `UPDATE_SLICE=1 npx vitest run <этот файл>`.
 */

const SLICE_URL = new URL("./builtinActions.palette.slice.json", import.meta.url);

describe("срез порядка палитры команд", () => {
    it("встроенные команды регистрируются в эталонном порядке", () => {
        const current = WORKBENCH_ACTIONS.map((action) => action.id);
        if (process.env.UPDATE_SLICE === "1") writeFileSync(SLICE_URL, `${JSON.stringify(current, null, 4)}\n`);
        const reference = JSON.parse(readFileSync(SLICE_URL, "utf8")) as string[];
        expect(current.length).toBeGreaterThan(100);
        expect(current).toEqual(reference);
    });
});
