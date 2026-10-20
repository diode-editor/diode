import { parseHexColor } from "../../../platform/theme/common/colorUtils.ts";
import { ColorId, FontStyle, MetadataConsts, TokenMetadata } from "../encodedTokenAttributes.ts";

import type { ITokenStyleResolver, ResolvedTokenStyle } from "./iTokenStyleResolver.ts";

/** Источник colorMap темы — `TokenizationRegistry` (upstream `TokenizationRegistry.getColorMap`). */
export interface IColorMapSource {
    getColorMap(): readonly string[] | null;
}

/** Биты метаданных, от которых зависит стиль: язык и вид токена на него не влияют. */
const STYLE_MASK =
    (MetadataConsts.FONT_STYLE_MASK | MetadataConsts.FOREGROUND_MASK | MetadataConsts.BACKGROUND_MASK) >>> 0;

/**
 * Стиль токена по метаданным и colorMap темы — то, что у эталона делают CSS-
 * классы `mtk<id>` (`generateTokensCSSForColorMap`). colorMap читается у
 * источника на каждый вызов: сменилась тема (новый массив) — разобранные цвета
 * и кэш стилей сбрасываются сами.
 */
export class ColorMapTokenStyleResolver implements ITokenStyleResolver {
    private readonly source: IColorMapSource;
    private colorMap: readonly string[] | null = null;
    private colors: (number | undefined)[] = [];
    private readonly cache = new Map<number, ResolvedTokenStyle>();

    public constructor(source: IColorMapSource) {
        this.source = source;
    }

    public resolve(metadata: number): ResolvedTokenStyle {
        const colorMap = this.source.getColorMap();
        if (colorMap !== this.colorMap) {
            this.colorMap = colorMap;
            this.colors = (colorMap ?? []).map((color) => (color === "" ? undefined : parseHexColor(color)));
            this.cache.clear();
        }

        const key = (metadata & STYLE_MASK) >>> 0;
        let style = this.cache.get(key);
        if (style === undefined) {
            const foreground = TokenMetadata.getForeground(key);
            const background = TokenMetadata.getBackground(key);
            const fontStyle = TokenMetadata.getFontStyle(key);
            style = {
                fg: foreground > ColorId.DefaultForeground ? this.colors[foreground] : undefined,
                bg: background > ColorId.DefaultBackground ? this.colors[background] : undefined,
                bold: (fontStyle & FontStyle.Bold) !== 0,
                italic: (fontStyle & FontStyle.Italic) !== 0,
                underline: (fontStyle & FontStyle.Underline) !== 0,
                strikethrough: (fontStyle & FontStyle.Strikethrough) !== 0,
            };
            this.cache.set(key, style);
        }
        return style;
    }
}
