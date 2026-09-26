import { describe, expect, it } from "vitest";

import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import { ColorThemeKind } from "../common/vscodeTypes.ts";

import { colorThemeKindOf, ThemeColorResolverAdapter } from "./themeColorResolverAdapter.ts";

function theme(type: WorkbenchTheme["type"], colors: Record<string, number> = {}): WorkbenchTheme {
    return new WorkbenchTheme(`${type} theme`, type, colors, { rules: [] });
}

describe("colorThemeKindOf", () => {
    it("переводит все четыре вида темы в vscode.ColorThemeKind", () => {
        expect(colorThemeKindOf("light")).toBe(ColorThemeKind.Light);
        expect(colorThemeKindOf("dark")).toBe(ColorThemeKind.Dark);
        expect(colorThemeKindOf("hc")).toBe(ColorThemeKind.HighContrast);
        expect(colorThemeKindOf("hcLight")).toBe(ColorThemeKind.HighContrastLight);
    });
});

describe("ThemeColorResolverAdapter", () => {
    it("kind() читает вид АКТИВНОЙ темы и едет за её сменой", () => {
        const service = new ThemeService(theme("dark"));
        const adapter = new ThemeColorResolverAdapter(service);
        expect(adapter.kind()).toBe(ColorThemeKind.Dark);

        service.setTheme(theme("hcLight"));
        expect(adapter.kind()).toBe(ColorThemeKind.HighContrastLight);
    });

    it("resolve() отдаёт цвет активной темы, неизвестный id — undefined", () => {
        const service = new ThemeService(theme("dark", { "editor.background": 0x1e1e1e }));
        const adapter = new ThemeColorResolverAdapter(service);
        expect(adapter.resolve("editor.background")).toBe(0x1e1e1e);
        expect(adapter.resolve("no.such.color")).toBeUndefined();
    });

    it("onDidChange проглатывает стартовый вызов и зовёт только на ПЕРЕХОДАХ", () => {
        const service = new ThemeService(theme("dark"));
        const adapter = new ThemeColorResolverAdapter(service);
        let calls = 0;
        const sub = adapter.onDidChange(() => calls++);
        expect(calls).toBe(0);

        service.setTheme(theme("light"));
        expect(calls).toBe(1);
        service.setTheme(theme("hc"));
        expect(calls).toBe(2);

        sub.dispose();
        service.setTheme(theme("dark"));
        expect(calls).toBe(2);
    });

    it("в момент вызова onDidChange kind() уже отдаёт НОВУЮ тему", () => {
        const service = new ThemeService(theme("dark"));
        const adapter = new ThemeColorResolverAdapter(service);
        const seen: number[] = [];
        adapter.onDidChange(() => seen.push(adapter.kind()));
        service.setTheme(theme("light"));
        expect(seen).toEqual([ColorThemeKind.Light]);
    });
});
