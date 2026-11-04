import { packRgba } from "@tuidom/core/common/colorUtils";

import { parseCssColor } from "../../../../../base/common/color.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type {
    IExtensionDecorationAttachment,
    IExtensionTextDecoration,
} from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
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
        const decorations = new SpawnDecorations(this.editorDecorations, this.fileDecorations, this.themeColorResolver);
        this.live = { rpc, decorations };
        const store = new DisposableStore();
        // overviewRulerColor makes the type a gutter change bar, backgroundColor/color paint the text, before/after
        // draw cells at its edges.
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

/** One layer of `before`/`after`; an absent field leaves the earlier layer's, as a CSS property does. */
interface IAttachmentLayer {
    readonly contentText?: string;
    readonly color?: DecorationColor;
    readonly backgroundColor?: DecorationColor;
    readonly borderColor?: DecorationColor;
    readonly italic?: boolean;
}

interface IEdgeLayers {
    readonly before: IThemed<IAttachmentLayer>;
    readonly after: IThemed<IAttachmentLayer>;
}

interface IDecorationType extends IEdgeLayers {
    /** `undefined` means the type doesn't paint the gutter. */
    readonly overviewRulerColorId: string | undefined;
    readonly isWholeLine: boolean;
    readonly stickiness: TrackedRangeStickiness | undefined;
    readonly background: IThemed<DecorationColor>;
    readonly foreground: IThemed<DecorationColor>;
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
    } = {};
    if (typeof o.contentText === "string") layer.contentText = o.contentText;
    const color = decorationColorOf(o.color);
    if (color !== undefined) layer.color = color;
    const backgroundColor = decorationColorOf(o.backgroundColor);
    if (backgroundColor !== undefined) layer.backgroundColor = backgroundColor;
    const borderColor = decorationColorOf(o.borderColor);
    if (borderColor !== undefined) layer.borderColor = borderColor;
    if (typeof o.fontStyle === "string") layer.italic = o.fontStyle === "italic" || o.fontStyle === "oblique";
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
        overviewRulerColorId: themeColorIdOf(o.overviewRulerColor),
        isWholeLine: o.isWholeLine === true,
        stickiness: stickinessOf(o.rangeBehavior),
        background: themed(options, (layer) => decorationColorOf(layer.backgroundColor)),
        foreground: themed(options, (layer) => decorationColorOf(layer.color)),
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

/** Like upstream's theme class selectors: `.vs-dark, .hc-black` take `dark`, `.vs, .hc-light` take `light`. */
function isDarkKind(kind: ColorThemeKind): boolean {
    return kind === ColorThemeKind.Dark || kind === ColorThemeKind.HighContrast;
}

class SpawnDecorations {
    private readonly types = new Map<number, IDecorationType>();
    private readonly editorDecorationsByFile = new Map<string, Map<number, readonly IDecorationRange[]>>();
    private readonly fileDecorationState = new Map<
        string,
        { badge: string | undefined; colorId: string | undefined; propagate: boolean | undefined }
    >();

    public constructor(
        private readonly editorDecorations: IEditorDecorationsService,
        private readonly fileDecorations: IFileDecorationsService,
        private readonly themeColorResolver: IThemeColorResolver,
    ) {}

    public createType(key: number, options: Record<string, unknown>): void {
        this.types.set(key, decorationTypeOf(options));
    }

    public disposeType(key: number): void {
        this.types.delete(key);
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            if (!byKey.delete(key)) continue;
            this.pushGutter(uri, byKey);
            this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations: [] });
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
        this.pushGutter(uri, byKey);
        this.pushText(uri, key, parsed, false);
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
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            this.editorDecorations.setGutterChangeDecorations(uri, []);
            for (const key of byKey.keys())
                this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations: [] });
        }
    }

    /** A theme change: the editors keep the tracked positions and take the colors of the new branch. */
    public repushAll(): void {
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            this.pushGutter(uri, byKey);
            for (const [key, ranges] of byKey) this.pushText(uri, key, ranges, true);
        }
        this.pushFileDecorations();
    }

    /** Gutter bars of types with overviewRulerColor, the full set for the resource in key (creation) order. */
    private pushGutter(uri: string, byKey: ReadonlyMap<number, readonly IDecorationRange[]>): void {
        const gutter: IGutterChangeDecoration[] = [];
        for (const [key, ranges] of [...byKey].sort(([a], [b]) => a - b)) {
            const type = this.types.get(key);
            if (type !== undefined) this.collectGutter(type, ranges, gutter);
        }
        this.editorDecorations.setGutterChangeDecorations(uri, gutter);
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
            for (const { range, edges } of ranges) {
                const before = this.resolveAttachment(type.before, edges.before, dark);
                const after = this.resolveAttachment(type.after, edges.after, dark);
                decorations.push({
                    range,
                    ...(bg === undefined ? {} : { bg }),
                    ...(fg === undefined ? {} : { fg }),
                    isWholeLine: type.isWholeLine,
                    ...(type.stickiness === undefined ? {} : { stickiness: type.stickiness }),
                    ...(before === undefined ? {} : { before }),
                    ...(after === undefined ? {} : { after }),
                });
            }
        }
        this.editorDecorations.setExtensionTextDecorations(uri, { key, decorations, ...(restyle ? { restyle } : {}) });
    }

    private collectGutter(
        type: IDecorationType,
        ranges: readonly IDecorationRange[],
        into: IGutterChangeDecoration[],
    ): void {
        const colorId = type.overviewRulerColorId;
        // Stryker disable next-line ConditionalExpression: the resolver returns undefined for an unknown id — the color check below skips the type the same way
        if (colorId === undefined) return;
        const color = this.themeColorResolver.resolve(colorId);
        if (color === undefined) return;
        // VS Code's dirty-diff draws modified lines dashed, added/deleted solid.
        const dashed = colorId === "editorGutter.modifiedBackground";
        for (const { range } of ranges) into.push({ range, color, ...(dashed ? { dashed: true } : {}) });
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
            return color === undefined ? undefined : { kind: "swatch", color };
        }
        const fg = this.resolveColor(merged.color);
        const bg = this.resolveColor(merged.backgroundColor);
        return {
            kind: "text",
            text,
            ...(fg === undefined ? {} : { fg }),
            ...(bg === undefined ? {} : { bg }),
            italic: merged.italic === true,
        };
    }

    /** The branch of the current theme kind, otherwise the own field; an unknown theme color id is no color. */
    private resolveThemed(color: IThemed<DecorationColor>, dark: boolean): number | undefined {
        return this.resolveColor((dark ? color.dark : color.light) ?? color.base);
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
