import { parseHexColor } from "../../../platform/theme/common/colorUtils.ts";
import { ColorId, FontStyle, MetadataConsts, TokenMetadata } from "../encodedTokenAttributes.ts";

import type { ITokenStyleResolver, ResolvedTokenStyle } from "./iTokenStyleResolver.ts";

export interface IColorMapSource {
    getColorMap(): readonly string[] | null;
}

/** Язык и вид токена на стиль не влияют. */
const STYLE_MASK =
    (MetadataConsts.FONT_STYLE_MASK | MetadataConsts.FOREGROUND_MASK | MetadataConsts.BACKGROUND_MASK) >>> 0;

/**
 * У эталона — CSS-классы `mtk<id>`. colorMap читается на каждый вызов: сменилась
 * тема (новый массив) — кэш сбрасывается сам.
 */
export class ColorMapTokenStyleResolver implements ITokenStyleResolver {
    private readonly source: IColorMapSource;
    private colorMap: readonly string[] | undefined = undefined;
    private colors: (number | undefined)[] = [];
    private readonly cache = new Map<number, ResolvedTokenStyle>();

    public constructor(source: IColorMapSource) {
        this.source = source;
    }

    public resolve(metadata: number): ResolvedTokenStyle {
        const colorMap = this.source.getColorMap();
        if (colorMap !== null && colorMap !== this.colorMap) {
            this.colorMap = colorMap;
            this.colors = colorMap.map((color) => (color === "" ? undefined : parseHexColor(color)));
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
