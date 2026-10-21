import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import { ColorId, FontStyle, StandardTokenType } from "../encodedTokenAttributes.ts";

import { ColorMapTokenStyleResolver } from "./colorMapTokenStyleResolver.ts";

const COLOR_MAP = ["", "#CCCCCC", "#1F1F1F", "#FF0000", "#00FF00"];

function resolverFor(colorMap: readonly string[] | null): ColorMapTokenStyleResolver {
    return new ColorMapTokenStyleResolver({ getColorMap: () => colorMap });
}

describe("ColorMapTokenStyleResolver", () => {
    it("цвет текста — из colorMap по индексу", () => {
        const style = resolverFor(COLOR_MAP).resolve(tokenMetadata({ foreground: 3 }));
        expect(style.fg).toBe(packRgb(0xff, 0, 0));
        expect(style.bg).toBeUndefined();
    });

    it("цвета по умолчанию (ColorId 0..1 для текста, 0..2 для фона) — undefined: ячейка берёт цвета редактора", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.DefaultForeground })).fg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.None })).fg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ background: ColorId.DefaultBackground })).bg).toBeUndefined();
        expect(resolver.resolve(tokenMetadata({ background: ColorId.DefaultForeground })).bg).toBeUndefined();
        // Index 2 for foreground is not a "default" but the editor background color.
        expect(resolver.resolve(tokenMetadata({ foreground: ColorId.DefaultBackground })).fg).toBe(
            packRgb(0x1f, 0x1f, 0x1f),
        );
    });

    it("фон — из colorMap по индексу больше 2", () => {
        expect(resolverFor(COLOR_MAP).resolve(tokenMetadata({ background: 4 })).bg).toBe(packRgb(0, 0xff, 0));
    });

    it("каждый бит FontStyle — свой флаг", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Bold }))).toMatchObject({
            bold: true,
            italic: false,
            underline: false,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Italic }))).toMatchObject({
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Underline }))).toMatchObject({
            bold: false,
            italic: false,
            underline: true,
            strikethrough: false,
        });
        expect(resolver.resolve(tokenMetadata({ fontStyle: FontStyle.Strikethrough }))).toMatchObject({
            bold: false,
            italic: false,
            underline: false,
            strikethrough: true,
        });
    });

    it("индекс вне colorMap или пустой слот — undefined", () => {
        const resolver = resolverFor(COLOR_MAP);
        expect(resolver.resolve(tokenMetadata({ foreground: 100 })).fg).toBeUndefined();
        expect(
            resolverFor(["", "#CCCCCC", "#1F1F1F", ""]).resolve(tokenMetadata({ foreground: 3 })).fg,
        ).toBeUndefined();
    });

    it("темы ещё нет (colorMap null) — цветов нет, начертание есть", () => {
        const style = resolverFor(null).resolve(tokenMetadata({ foreground: 3, fontStyle: FontStyle.Bold }));
        expect(style.fg).toBeUndefined();
        expect(style.bold).toBe(true);
    });

    it("стиль кэшируется по битам стиля: вид токена и язык на него не влияют", () => {
        const resolver = resolverFor(COLOR_MAP);
        const a = resolver.resolve(tokenMetadata({ foreground: 3, tokenType: StandardTokenType.Comment }));
        const b = resolver.resolve(tokenMetadata({ foreground: 3, tokenType: StandardTokenType.String }) | 7);
        expect(b).toBe(a);
        expect(resolver.resolve(tokenMetadata({ foreground: 4 }))).not.toBe(a);
    });

    it("новый colorMap у источника (смена темы) — цвета и кэш пересчитываются", () => {
        let colorMap: readonly string[] = COLOR_MAP;
        const resolver = new ColorMapTokenStyleResolver({ getColorMap: () => colorMap });
        const before = resolver.resolve(tokenMetadata({ foreground: 3 }));
        expect(before.fg).toBe(packRgb(0xff, 0, 0));

        colorMap = ["", "#CCCCCC", "#1F1F1F", "#0000FF"];
        const after = resolver.resolve(tokenMetadata({ foreground: 3 }));
        expect(after.fg).toBe(packRgb(0, 0, 0xff));
        expect(after).not.toBe(before);
    });
});
