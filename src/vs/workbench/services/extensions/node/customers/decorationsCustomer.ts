import { packRgba } from "@tuidom/core/common/colorUtils";
import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { truncateEnd } from "@tuidom/core/common/textTruncation";

import { parseCssColor } from "../../../../../base/common/color.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type {
    IExtensionDecorationAttachment,
    IExtensionTextDecoration,
} from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGlyphMarginDecoration } from "../../../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IOverviewRulerDecoration } from "../../../../../editor/common/model/iOverviewRulerDecoration.ts";
import { TrackedRangeStickiness } from "../../../../../editor/common/model/trackedDecorations.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorDecorationsService } from "../../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../../api/common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../../../../api/common/vscodeTypes.ts";
import type {
    IWireColorTheme,
    IWireDecorationOptions,
    SerializedColor,
    SerializedDecorationRenderOptions,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseDecorationOptions, parseWireFileDecorations, themeColorIdOf } from "../hostWireParsers.ts";

import {
    gutterIconContentOf,
    gutterIconGlyphOf,
    type GutterIconReader,
    type IGutterIconGlyph,
} from "./gutterIconGlyph.ts";

export type { GutterIconReader } from "./gutterIconGlyph.ts";

const NO_GUTTER_ICONS: GutterIconReader = () => Promise.reject(new Error("no file service"));

/** A gutter icon without a color of its own takes the line numbers' color. */
const GUTTER_ICON_COLOR_TOKEN = "editorLineNumber.foreground";

/**
 * Decoration types and sets live for one spawn (on respawn the extension redraws them); the theme subscription
 * lives with the host.
 */
export class DecorationsCustomer extends Disposable implements IExtensionHostCustomer {
    private live: { readonly rpc: HostRpc; readonly decorations: SpawnDecorations } | null = null;

    public constructor(
        private readonly editorDecorations: IEditorDecorationsService,
        private readonly fileDecorations: IFileDecorationsService,
        private readonly themeColorResolver: IThemeColorResolver,
        private readonly readGutterIcon: GutterIconReader = NO_GUTTER_ICONS,
    ) {
        super();
        this.register(
            themeColorResolver.onDidChange(() => {
                this.live?.decorations.repushAll();
                this.pushActiveColorTheme();
            }),
        );
    }

    /** No-op without a subprocess: the theme arrives as a seed when it comes up. */
    public pushActiveColorTheme(): void {
        const theme: IWireColorTheme = { kind: this.themeColorResolver.kind() };
        this.live?.rpc.notify("window.themeChanged", theme);
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const decorations = new SpawnDecorations(
            this.editorDecorations,
            this.fileDecorations,
            this.themeColorResolver,
            this.readGutterIcon,
        );
        this.live = { rpc, decorations };
        const store = new DisposableStore();
        // overviewRulerColor marks the scrollbar, gutterIconPath puts a glyph in the gutter, backgroundColor/color
        // paint the text, before/after draw cells at its edges.
        store.add(
            rpc.handleNotification("window.createTextEditorDecorationType", (params) => {
                const p: { key?: unknown; options?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: a type with a non-numeric key is unobservable — setDecorations, which has its own key guard, never reaches it
                if (typeof p.key !== "number") return;
                decorations.createType(p.key, asRecord(p.options));
            }),
        );
        store.add(
            rpc.handleNotification("window.disposeTextEditorDecorationType", (params) => {
                const p: { key?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: removing a non-numeric key is a no-op: no such key exists in the registry or in file sets
                if (typeof p.key !== "number") return;
                decorations.disposeType(p.key);
            }),
        );
        store.add(
            rpc.handleNotification("editor.setDecorations", (params) => {
                const p: { key?: unknown; uri?: unknown; ranges?: unknown } = params;
                if (typeof p.key !== "number" || typeof p.uri !== "string") return;
                decorations.setRanges(p.key, p.uri, parseDecorationOptions(p.ranges));
            }),
        );
        // A bare uri without color/badge means removal.
        store.add(
            rpc.handleNotification("window.fileDecorationsChanged", (params) => {
                const p: { decorations?: unknown } = params;
                decorations.mergeFileDecorations(parseWireFileDecorations(p.decorations));
            }),
        );
        // The next spawn attaches only after this one has gone, so
        // it's safe to remove without checking “is the live one ours”.
        store.add({
            dispose: () => {
                // A dead extension no longer owns what it painted; on respawn it redraws.
                decorations.clearEditorDecorations();
                this.live = null;
            },
        });
        return store;
    }
}

/**
 * A CSS string is parsed once, on arrival, into packed RGBA (`number`); a theme color stays its id
 * (`string`) and resolves on each push, as the theme may change.
 */
type DecorationColor = number | string;

/** `base` is the own field, `light`/`dark` the branch's: the branch of the current theme wins. */
interface IThemed<T> {
    readonly base: T | undefined;
    readonly light: T | undefined;
    readonly dark: T | undefined;
}

/** The horizontal sides of a CSS `margin`, in cells; the vertical ones have no cell counterpart. */
interface IHorizontalMargin {
    readonly left: number;
    readonly right: number;
}

/** One layer of `before`/`after`; an absent field leaves the earlier layer's, as a CSS property does. */
interface IAttachmentLayer {
    readonly contentText?: string;
    readonly color?: DecorationColor;
    readonly backgroundColor?: DecorationColor;
    readonly borderColor?: DecorationColor;
    readonly italic?: boolean;
    readonly bold?: boolean;
    readonly textDecoration?: StyleFlags;
    readonly margin?: IHorizontalMargin;
    /** Cells, at least one. */
    readonly width?: number;
}

interface IEdgeLayers {
    readonly before: IThemed<IAttachmentLayer>;
    readonly after: IThemed<IAttachmentLayer>;
}

interface IDecorationType extends IEdgeLayers {
    /** Upstream draws it in the overview ruler only, never in the gutter. */
    readonly overviewRuler: IThemed<DecorationColor>;
    /** `uri.toString()` of the icon. */
    readonly gutterIcon: IThemed<string>;
    readonly isWholeLine: boolean;
    readonly stickiness: TrackedRangeStickiness | undefined;
    readonly background: IThemed<DecorationColor>;
    readonly foreground: IThemed<DecorationColor>;
    /** `fontStyle`, `fontWeight` and `textDecoration`, each a CSS property of its own: a theme branch wins per one. */
    readonly italic: IThemed<boolean>;
    readonly bold: IThemed<boolean>;
    readonly textDecoration: IThemed<StyleFlags>;
    readonly opacity: IThemed<number>;
}

/** A range of `setDecorations` and its own `renderOptions` (all layers `undefined` without them). */
interface IDecorationRange {
    readonly range: IRange;
    readonly edges: IEdgeLayers;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Garbage (an unparsable string, a non-color) is no color: the other fields live on. */
function decorationColorOf(value: unknown): DecorationColor | undefined {
    if (typeof value !== "string") return themeColorIdOf(value as SerializedColor | undefined);
    const rgba = parseCssColor(value);
    return rgba === null ? undefined : packRgba(rgba.r, rgba.g, rgba.b, Math.round(rgba.a * 255));
}

function themed<T>(
    options: Record<string, unknown>,
    of: (layer: Record<string, unknown>) => T | undefined,
): IThemed<T> {
    return { base: of(options), light: of(asRecord(options.light)), dark: of(asRecord(options.dark)) };
}

/** `italic` and `oblique` lean the glyph, `normal` doesn't; anything else is no value. */
function italicOf(value: unknown): boolean | undefined {
    if (value === "italic" || value === "oblique") return true;
    return value === "normal" ? false : undefined;
}

/** A cell has one weight: `bold`, `bolder` and 600 or more are bold; `normal`, `lighter` and below 600 are not. */
function boldOf(value: unknown): boolean | undefined {
    if (typeof value !== "string") return undefined;
    const weight = value.trim();
    if (weight === "bold" || weight === "bolder") return true;
    if (weight === "normal" || weight === "lighter") return false;
    const numeric = Number(weight);
    return weight !== "" && Number.isFinite(numeric) ? numeric >= 600 : undefined;
}

/**
 * The lines of the CSS `text-decoration` shorthand a cell has: `underline` (`wavy` makes it a curl) and
 * `line-through`; `overline`, colors and thickness are dropped. Extensions append CSS after `;` (`none; display:
 * none`), which the cell ignores. `none` is no lines.
 */
function textDecorationOf(value: unknown): StyleFlags | undefined {
    if (typeof value !== "string") return undefined;
    const words = value.split(";", 1)[0].toLowerCase().split(/\s/);
    let flags: number = StyleFlags.None;
    if (words.includes("underline")) flags |= words.includes("wavy") ? StyleFlags.Undercurl : StyleFlags.Underline;
    if (words.includes("line-through")) flags |= StyleFlags.Strikethrough;
    return flags;
}

/** A CSS `<number>` (no hex, no `Infinity`, unlike `Number()`) and an optional percent sign. */
const CSS_ALPHA = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i;

/** A CSS `<alpha-value>`: a number or a percentage, clamped to [0, 1]; garbage is no value. */
function opacityOf(value: unknown): number | undefined {
    if (typeof value !== "string") return undefined;
    const match = CSS_ALPHA.exec(value.trim());
    if (match === null) return undefined;
    const numeric = Number(match[1]);
    return Math.min(1, Math.max(0, match[2] === "%" ? numeric / 100 : numeric));
}

/** A CSS `<number>` and a unit a cell count can be taken from. */
const CSS_LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ch|r?em|px)$/;

/** The `ch` addends of a `calc()`, with the sign of the operator before each. */
const CALC_CH_TERM = /([+-]?)\s*((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)ch\b/g;

/**
 * A CSS length in cells, approximately: a cell is `1ch` wide, about half an `em` and 8 pixels. `calc()` counts its
 * `ch` addends only (GitLens's `calc(12ch - 6px)` is 12 cells); anything else, and a negative length, is 0.
 */
function cellsOf(length: string): number {
    const value = length.toLowerCase();
    let cells = 0;
    if (value.startsWith("calc(")) {
        for (const [, sign, numeric] of value.matchAll(CALC_CH_TERM)) {
            cells += sign === "-" ? -Number(numeric) : Number(numeric);
        }
    } else {
        const match = CSS_LENGTH.exec(value);
        if (match !== null) {
            const numeric = Number(match[1]);
            cells = match[2] === "ch" ? numeric : match[2] === "px" ? numeric / 8 : numeric * 2;
        }
    }
    return Math.max(0, Math.round(cells));
}

/** The values of a CSS shorthand: whitespace inside `calc(…)` doesn't split. */
function shorthandValuesOf(value: string): string[] {
    const values: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
        if (char === "(") depth++;
        if (char === ")") depth--;
        if (depth === 0 && /\s/.test(char)) {
            if (current !== "") values.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    if (current !== "") values.push(current);
    return values;
}

/**
 * The horizontal sides of the CSS `margin` shorthand: one value is every side, two are (vertical, horizontal),
 * three (top, horizontal, bottom), four (top, right, bottom, left). Garbage is no value.
 */
function marginOf(value: unknown): IHorizontalMargin | undefined {
    if (typeof value !== "string") return undefined;
    const values = shorthandValuesOf(value);
    if (values.length === 0 || values.length > 4) return undefined;
    const right = values[Math.min(1, values.length - 1)];
    const left = values.length === 4 ? values[3] : right;
    return { left: cellsOf(left), right: cellsOf(right) };
}

/** Exactly `width` cells: a short text is padded with spaces in its own background, a long one is cut. */
function fitToWidth(text: string, width: number | undefined): string {
    if (width === undefined) return text;
    const fitted = truncateEnd(text, width, "");
    return fitted + " ".repeat(width - measureTextWidth(fitted));
}

/** Only the fields a cell can draw; a non-object is no layer. */
function attachmentLayerOf(raw: unknown): IAttachmentLayer | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    const layer: {
        contentText?: string;
        color?: DecorationColor;
        backgroundColor?: DecorationColor;
        borderColor?: DecorationColor;
        italic?: boolean;
        bold?: boolean;
        textDecoration?: StyleFlags;
        margin?: IHorizontalMargin;
        width?: number;
    } = {};
    if (typeof o.contentText === "string") layer.contentText = o.contentText;
    const color = decorationColorOf(o.color);
    if (color !== undefined) layer.color = color;
    const backgroundColor = decorationColorOf(o.backgroundColor);
    if (backgroundColor !== undefined) layer.backgroundColor = backgroundColor;
    const borderColor = decorationColorOf(o.borderColor);
    if (borderColor !== undefined) layer.borderColor = borderColor;
    if (typeof o.fontStyle === "string") layer.italic = o.fontStyle === "italic" || o.fontStyle === "oblique";
    const bold = boldOf(o.fontWeight);
    if (bold !== undefined) layer.bold = bold;
    const textDecoration = textDecorationOf(o.textDecoration);
    if (textDecoration !== undefined) layer.textDecoration = textDecoration;
    const margin = marginOf(o.margin);
    if (margin !== undefined) layer.margin = margin;
    // A width that rounds to no cell is no width: upstream text spills out of a too narrow box.
    const width = typeof o.width === "string" ? cellsOf(o.width) : 0;
    if (width > 0) layer.width = width;
    return layer;
}

function edgeLayersOf(options: Record<string, unknown>): IEdgeLayers {
    return {
        before: themed(options, (layer) => attachmentLayerOf(layer.before)),
        after: themed(options, (layer) => attachmentLayerOf(layer.after)),
    };
}

/** `DecorationRangeBehavior` and `TrackedRangeStickiness` share their values, as upstream maps them one to one. */
function stickinessOf(rangeBehavior: unknown): TrackedRangeStickiness | undefined {
    return typeof rangeBehavior === "number" && rangeBehavior in TrackedRangeStickiness
        ? (rangeBehavior as TrackedRangeStickiness)
        : undefined;
}

function decorationTypeOf(options: Record<string, unknown>): IDecorationType {
    const o = options as SerializedDecorationRenderOptions & Record<string, unknown>;
    return {
        overviewRuler: themed(options, (layer) => decorationColorOf(layer.overviewRulerColor)),
        gutterIcon: themed(options, (layer) =>
            typeof layer.gutterIconPath === "string" ? layer.gutterIconPath : undefined,
        ),
        isWholeLine: o.isWholeLine === true,
        stickiness: stickinessOf(o.rangeBehavior),
        background: themed(options, (layer) => decorationColorOf(layer.backgroundColor)),
        foreground: themed(options, (layer) => decorationColorOf(layer.color)),
        italic: themed(options, (layer) => italicOf(layer.fontStyle)),
        bold: themed(options, (layer) => boldOf(layer.fontWeight)),
        textDecoration: themed(options, (layer) => textDecorationOf(layer.textDecoration)),
        opacity: themed(options, (layer) => opacityOf(layer.opacity)),
        ...edgeLayersOf(options),
    };
}

function decorationRangeOf({ range, renderOptions }: IWireDecorationOptions): IDecorationRange {
    return { range, edges: edgeLayersOf(asRecord(renderOptions)) };
}

/**
 * Upstream `getCSSTextForModelDecorationContentClassName` takes the first line only; a tab would break the cell
 * grid and a control character has no glyph.
 */
function contentTextOf(raw: string): string {
    return raw
        .split(/[\r\n]/, 1)[0]
        .replaceAll("\t", " ")
        .replace(/\p{Cc}/gu, "");
}

/** No key for a side without cells. */
function marginCellsOf(margin: IHorizontalMargin | undefined): { marginLeft?: number; marginRight?: number } {
    return {
        ...(margin === undefined || margin.left === 0 ? {} : { marginLeft: margin.left }),
        ...(margin === undefined || margin.right === 0 ? {} : { marginRight: margin.right }),
    };
}

/** Like upstream's theme class selectors: `.vs-dark, .hc-black` take `dark`, `.vs, .hc-light` take `light`. */
function isDarkKind(kind: ColorThemeKind): boolean {
    return kind === ColorThemeKind.Dark || kind === ColorThemeKind.HighContrast;
}

/** The branch of the current theme kind, otherwise the own field. */
function themedValue<T>(value: IThemed<T>, dark: boolean): T | undefined {
    return (dark ? value.dark : value.light) ?? value.base;
}

/** The attributes the type adds to the glyphs; a `normal` weight or style adds nothing (the token's stays). */
function textStyleOf(type: IDecorationType, dark: boolean): StyleFlags {
    let style: number = themedValue(type.textDecoration, dark) ?? StyleFlags.None;
    if (themedValue(type.italic, dark) === true) style |= StyleFlags.Italic;
    if (themedValue(type.bold, dark) === true) style |= StyleFlags.Bold;
    return style;
}

function hasGutterIcon(type: IDecorationType): boolean {
    return (
        type.gutterIcon.base !== undefined || type.gutterIcon.light !== undefined || type.gutterIcon.dark !== undefined
    );
}

/** One glyph lane layer per decoration type. */
function glyphOwnerOf(key: number): string {
    return `ext:${String(key)}`;
}

class SpawnDecorations {
    private readonly types = new Map<number, IDecorationType>();
    /** Each icon is read once per spawn; `undefined` while the read is in flight. */
    private readonly gutterIcons = new Map<string, IGutterIconGlyph | undefined>();
    private cleared = false;
    private readonly editorDecorationsByFile = new Map<string, Map<number, readonly IDecorationRange[]>>();
    private readonly fileDecorationState = new Map<
        string,
        { badge: string | undefined; colorId: string | undefined; propagate: boolean | undefined }
    >();

    public constructor(
        private readonly editorDecorations: IEditorDecorationsService,
        private readonly fileDecorations: IFileDecorationsService,
        private readonly themeColorResolver: IThemeColorResolver,
        private readonly readGutterIcon: GutterIconReader,
    ) {}

    public createType(key: number, options: Record<string, unknown>): void {
        this.types.set(key, decorationTypeOf(options));
    }

    public disposeType(key: number): void {
        const type = this.types.get(key);
        this.types.delete(key);
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            if (!byKey.delete(key)) continue;
            this.pushOverviewRuler(uri, byKey);
            this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations: [] });
            this.clearGlyphs(uri, key, type);
        }
    }

    public setRanges(key: number, uri: string, ranges: readonly IWireDecorationOptions[]): void {
        let byKey = this.editorDecorationsByFile.get(uri);
        if (byKey === undefined) {
            byKey = new Map();
            this.editorDecorationsByFile.set(uri, byKey);
        }
        // An empty set draws nothing — that is how it removes the type's bars and paint.
        const parsed = ranges.map(decorationRangeOf);
        byKey.set(key, parsed);
        this.pushOverviewRuler(uri, byKey);
        this.pushText(uri, key, parsed, false);
        this.pushGlyphs(uri, key, parsed);
    }

    public mergeFileDecorations(changed: ReturnType<typeof parseWireFileDecorations>): void {
        for (const d of changed) {
            const filePath = fileUriToPath(d.uri);
            if (filePath === null) continue;
            if (d.badge === undefined && d.colorId === undefined) {
                this.fileDecorationState.delete(filePath);
            } else {
                this.fileDecorationState.set(filePath, { badge: d.badge, colorId: d.colorId, propagate: d.propagate });
            }
        }
        this.pushFileDecorations();
    }

    public clearEditorDecorations(): void {
        // An icon read still in flight must not draw the dead spawn's glyphs back.
        this.cleared = true;
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            this.editorDecorations.setOverviewRulerDecorations(uri, []);
            for (const key of byKey.keys()) {
                this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations: [] });
                this.clearGlyphs(uri, key, this.types.get(key));
            }
        }
    }

    /** A type without an icon never touched the glyph lane: nothing to clear. */
    private clearGlyphs(uri: string, key: number, type: IDecorationType | undefined): void {
        if (type !== undefined && hasGutterIcon(type)) {
            this.editorDecorations.setGlyphMarginDecorations(uri, glyphOwnerOf(key), []);
        }
    }

    /** A theme change: the editors keep the tracked positions and take the colors of the new branch. */
    public repushAll(): void {
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            this.pushOverviewRuler(uri, byKey);
            for (const [key, ranges] of byKey) {
                this.pushText(uri, key, ranges, true);
                this.pushGlyphs(uri, key, ranges);
            }
        }
        this.pushFileDecorations();
    }

    /** Scrollbar marks of types with overviewRulerColor, the full set for the resource in key (creation) order. */
    private pushOverviewRuler(uri: string, byKey: ReadonlyMap<number, readonly IDecorationRange[]>): void {
        const dark = isDarkKind(this.themeColorResolver.kind());
        const marks: IOverviewRulerDecoration[] = [];
        for (const [key, ranges] of [...byKey].sort(([a], [b]) => a - b)) {
            const type = this.types.get(key);
            const color = type === undefined ? undefined : this.resolveThemed(type.overviewRuler, dark);
            if (color !== undefined) for (const { range } of ranges) marks.push({ range, color });
        }
        this.editorDecorations.setOverviewRulerDecorations(uri, marks);
    }

    /**
     * The type's icon on every line of each range (upstream's glyph margin covers the range's lines), under the
     * breakpoints' higher `zIndex`. An icon still being read draws nothing yet: its read pushes again.
     */
    private pushGlyphs(uri: string, key: number, ranges: readonly IDecorationRange[]): void {
        const type = this.types.get(key);
        if (type === undefined || !hasGutterIcon(type)) return;
        const icon = themedValue(type.gutterIcon, isDarkKind(this.themeColorResolver.kind()));
        const shown = icon === undefined ? undefined : this.gutterIconGlyph(icon);
        const glyphs: IGlyphMarginDecoration[] = [];
        if (shown !== undefined) {
            const lines = new Set<number>();
            for (const { range } of ranges) {
                for (let line = range.start.line; line <= range.end.line; line++) lines.add(line);
            }
            const { glyph, color } = shown;
            for (const line of lines) {
                glyphs.push({
                    key: String(line),
                    line,
                    glyph,
                    colorToken: GUTTER_ICON_COLOR_TOKEN,
                    ...(color === undefined ? {} : { color }),
                });
            }
        }
        this.editorDecorations.setGlyphMarginDecorations(uri, glyphOwnerOf(key), glyphs);
    }

    private gutterIconGlyph(icon: string): IGutterIconGlyph | undefined {
        if (this.gutterIcons.has(icon)) return this.gutterIcons.get(icon);
        this.gutterIcons.set(icon, undefined);
        void gutterIconContentOf(icon, this.readGutterIcon).then((content) => {
            this.gutterIcons.set(icon, gutterIconGlyphOf(content));
            if (!this.cleared) this.repushGlyphsOf(icon);
        });
        return undefined;
    }

    /** The types showing `icon` in the current theme, the others have nothing new to draw. */
    private repushGlyphsOf(icon: string): void {
        const dark = isDarkKind(this.themeColorResolver.kind());
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            for (const [key, ranges] of byKey) {
                const type = this.types.get(key);
                if (type !== undefined && themedValue(type.gutterIcon, dark) === icon)
                    this.pushGlyphs(uri, key, ranges);
            }
        }
    }

    /**
     * Every range of the type goes, even one that draws nothing in this theme: a restyle keeps the editor's tracked
     * positions by index.
     */
    private pushText(uri: string, key: number, ranges: readonly IDecorationRange[], restyle: boolean): void {
        const type = this.types.get(key);
        const decorations: IExtensionTextDecoration[] = [];
        if (type !== undefined) {
            const dark = isDarkKind(this.themeColorResolver.kind());
            const bg = this.resolveThemed(type.background, dark);
            const fg = this.resolveThemed(type.foreground, dark);
            const style = textStyleOf(type, dark);
            const opacity = themedValue(type.opacity, dark);
            for (const { range, edges } of ranges) {
                const before = this.resolveAttachment(type.before, edges.before, dark);
                const after = this.resolveAttachment(type.after, edges.after, dark);
                decorations.push({
                    range,
                    ...(bg === undefined ? {} : { bg }),
                    ...(fg === undefined ? {} : { fg }),
                    ...(style === StyleFlags.None ? {} : { style }),
                    // Fully opaque text needs no blend; 0 turns the glyph into its background, as in CSS.
                    ...(opacity === undefined || opacity === 1 ? {} : { opacity }),
                    isWholeLine: type.isWholeLine,
                    ...(type.stickiness === undefined ? {} : { stickiness: type.stickiness }),
                    ...(before === undefined ? {} : { before }),
                    ...(after === undefined ? {} : { after }),
                });
            }
        }
        this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations, ...(restyle ? { restyle } : {}) });
    }

    /**
     * Upstream registers the range's `renderOptions` as a subtype (`.sub.parent::before`): the type, its theme
     * branch, the range, the range's branch — a later layer wins field by field. Empty or blank `contentText` with a
     * color (`backgroundColor`, else `borderColor`, else `color`) is a swatch; with no text and no color nothing is
     * drawn.
     */
    private resolveAttachment(
        type: IThemed<IAttachmentLayer>,
        range: IThemed<IAttachmentLayer>,
        dark: boolean,
    ): IExtensionDecorationAttachment | undefined {
        const branch = (layers: IThemed<IAttachmentLayer>) => (dark ? layers.dark : layers.light);
        const layers = [type.base, branch(type), range.base, branch(range)];
        const merged = layers.reduce<IAttachmentLayer>((acc, layer) => ({ ...acc, ...layer }), {});
        const text = contentTextOf(merged.contentText ?? "");
        if (text.trim() === "") {
            const color =
                this.resolveColor(merged.backgroundColor) ??
                this.resolveColor(merged.borderColor) ??
                this.resolveColor(merged.color);
            return color === undefined ? undefined : { kind: "swatch", color, ...marginCellsOf(merged.margin) };
        }
        const fg = this.resolveColor(merged.color);
        const bg = this.resolveColor(merged.backgroundColor);
        let style: number = merged.textDecoration ?? StyleFlags.None;
        if (merged.italic === true) style |= StyleFlags.Italic;
        if (merged.bold === true) style |= StyleFlags.Bold;
        return {
            kind: "text",
            text: fitToWidth(text, merged.width),
            ...(fg === undefined ? {} : { fg }),
            ...(bg === undefined ? {} : { bg }),
            style,
            ...marginCellsOf(merged.margin),
        };
    }

    /** The branch of the current theme kind, otherwise the own field; an unknown theme color id is no color. */
    private resolveThemed(color: IThemed<DecorationColor>, dark: boolean): number | undefined {
        return this.resolveColor(themedValue(color, dark));
    }

    private resolveColor(color: DecorationColor | undefined): number | undefined {
        return typeof color === "string" ? this.themeColorResolver.resolve(color) : color;
    }

    /** `propagate` goes as is: propagation to folders is computed by the tree, which knows its root. */
    private pushFileDecorations(): void {
        const entries: { path: string; color?: number; badge?: string; propagate?: boolean }[] = [];
        for (const [path, { badge, colorId, propagate }] of this.fileDecorationState) {
            // Stryker disable next-line ConditionalExpression: the resolver returns undefined for an unknown (including empty) id — no color in both cases
            const color = colorId === undefined ? undefined : this.themeColorResolver.resolve(colorId);
            entries.push({
                path,
                ...(color === undefined ? {} : { color }),
                ...(badge === undefined ? {} : { badge }),
                ...(propagate === undefined ? {} : { propagate }),
            });
        }
        this.fileDecorations.setFileDecorations(entries);
    }
}

/**
 * `null` means the resource isn't on disk: the tree is addressed by paths, and a `git:` resource as a
 * `fileDecorationState` key would silently match no path.
 */
function fileUriToPath(uri: string): string | null {
    const parsed = Uri.parse(uri);
    return parsed.scheme === "file" ? parsed.fsPath : null;
}
