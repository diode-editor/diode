import { describe, expect, it } from "vitest";

import { parseHexColor } from "../colorUtils.ts";
import type { IThemeFile } from "../iThemeFile.ts";
import { WorkbenchTheme } from "../workbenchTheme.ts";

import type { IWorkbenchColors } from "./colorContributions.ts";

/**
 * Цвета графа коммитов виджеты берут по имени токена, поэтому каждый обязан
 * резолвиться на теме, которая их не переопределяет. Ожидаемые значения —
 * дефолты vscode (`scmHistory.ts`): пять цветов линий одинаковы на dark и
 * light, семантические цвета ref'ов различаются.
 */
const EXPECTED: Record<"dark" | "light", Partial<Record<keyof IWorkbenchColors, string>>> = {
    dark: {
        "scmGraph.foreground1": "#FFB000",
        "scmGraph.foreground2": "#DC267F",
        "scmGraph.foreground3": "#994F00",
        "scmGraph.foreground4": "#40B0A6",
        "scmGraph.foreground5": "#B66DFF",
        "scmGraph.historyItemRefColor": "#3794FF",
        "scmGraph.historyItemRemoteRefColor": "#B180D7",
        "scmGraph.historyItemBaseRefColor": "#EA5C00",
    },
    light: {
        "scmGraph.foreground1": "#FFB000",
        "scmGraph.foreground2": "#DC267F",
        "scmGraph.foreground3": "#994F00",
        "scmGraph.foreground4": "#40B0A6",
        "scmGraph.foreground5": "#B66DFF",
        "scmGraph.historyItemRefColor": "#1A85FF",
        "scmGraph.historyItemRemoteRefColor": "#652D90",
        "scmGraph.historyItemBaseRefColor": "#EA5C00",
    },
};

const KIND_TO_TYPE: Record<"dark" | "light", IThemeFile["type"]> = { dark: "dark", light: "light" };

describe("source control graph color defaults", () => {
    for (const kind of ["dark", "light"] as const) {
        const theme = WorkbenchTheme.fromThemeFile({ type: KIND_TO_TYPE[kind], colors: {} });

        for (const [key, hex] of Object.entries(EXPECTED[kind]) as [keyof IWorkbenchColors, string][]) {
            it(`resolves "${key}" to ${hex} on the ${kind} default palette`, () => {
                expect(theme.getColor(key)).toBe(parseHexColor(hex));
            });
        }
    }
});
