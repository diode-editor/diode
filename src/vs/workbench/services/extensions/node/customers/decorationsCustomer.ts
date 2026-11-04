import { packRgba } from "@tuidom/core/common/colorUtils";

import { parseCssColor } from "../../../../../base/common/color.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type { IExtensionTextDecoration } from "../../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorDecorationsService } from "../../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../../api/common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../../../../api/common/vscodeTypes.ts";
import type {
    IWireColorTheme,
    SerializedColor,
    SerializedDecorationRenderOptions,
    SerializedThemableDecorationRenderOptions,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseDecorationRanges, parseWireFileDecorations, themeColorIdOf } from "../hostWireParsers.ts";

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
        // overviewRulerColor makes the type a gutter change bar, backgroundColor/color paint the text.
        store.add(
            rpc.handleNotification("window.createTextEditorDecorationType", (params) => {
                const p: { key?: unknown; options?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: a type with a non-numeric key is unobservable — setDecorations, which has its own key guard, never reaches it
                if (typeof p.key !== "number") return;
                // A non-object in options carries no fields — a type that draws nothing.
                const options = (p.options ?? {}) as SerializedDecorationRenderOptions;
                decorations.createType(p.key, options);
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
                decorations.setRanges(p.key, p.uri, parseDecorationRanges(p.ranges));
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
 * A CSS string is parsed once, on type creation, into packed RGBA (`number`); a theme color stays its id
 * (`string`) and resolves on each push, as the theme may change.
 */
type DecorationColor = number | string;

/** `base` is the type's own field, `light`/`dark` the branch's: the branch of the current theme wins. */
interface IThemedDecorationColor {
    readonly base: DecorationColor | undefined;
    readonly light: DecorationColor | undefined;
    readonly dark: DecorationColor | undefined;
}

interface IDecorationType {
    /** `undefined` means the type doesn't paint the gutter. */
    readonly overviewRulerColorId: string | undefined;
    readonly isWholeLine: boolean;
    readonly background: IThemedDecorationColor;
    readonly foreground: IThemedDecorationColor;
}

/** Garbage (an unparsable string, a non-color) is no color: the type's other fields live on. */
function decorationColorOf(value: SerializedColor | undefined): DecorationColor | undefined {
    if (typeof value !== "string") return themeColorIdOf(value);
    const rgba = parseCssColor(value);
    return rgba === null ? undefined : packRgba(rgba.r, rgba.g, rgba.b, Math.round(rgba.a * 255));
}

function themedColorOf(
    options: SerializedDecorationRenderOptions,
    field: keyof SerializedThemableDecorationRenderOptions,
): IThemedDecorationColor {
    return {
        base: decorationColorOf(options[field]),
        light: decorationColorOf(options.light?.[field]),
        dark: decorationColorOf(options.dark?.[field]),
    };
}

function decorationTypeOf(options: SerializedDecorationRenderOptions): IDecorationType {
    return {
        overviewRulerColorId: themeColorIdOf(options.overviewRulerColor),
        isWholeLine: options.isWholeLine === true,
        background: themedColorOf(options, "backgroundColor"),
        foreground: themedColorOf(options, "color"),
    };
}

/** Like upstream's theme class selectors: `.vs-dark, .hc-black` take `dark`, `.vs, .hc-light` take `light`. */
function isDarkKind(kind: ColorThemeKind): boolean {
    return kind === ColorThemeKind.Dark || kind === ColorThemeKind.HighContrast;
}

class SpawnDecorations {
    private readonly types = new Map<number, IDecorationType>();
    private readonly editorDecorationsByFile = new Map<string, Map<number, readonly IRange[]>>();
    private readonly fileDecorationState = new Map<
        string,
        { badge: string | undefined; colorId: string | undefined; propagate: boolean | undefined }
    >();

    public constructor(
        private readonly editorDecorations: IEditorDecorationsService,
        private readonly fileDecorations: IFileDecorationsService,
        private readonly themeColorResolver: IThemeColorResolver,
    ) {}

    public createType(key: number, options: SerializedDecorationRenderOptions): void {
        this.types.set(key, decorationTypeOf(options));
    }

    public disposeType(key: number): void {
        this.types.delete(key);
        const affected: string[] = [];
        for (const [uri, byKey] of this.editorDecorationsByFile) {
            if (byKey.delete(key)) affected.push(uri);
        }
        for (const uri of affected) this.pushEditorDecorations(uri);
    }

    public setRanges(key: number, uri: string, ranges: readonly IRange[]): void {
        let byKey = this.editorDecorationsByFile.get(uri);
        if (byKey === undefined) {
            byKey = new Map();
            this.editorDecorationsByFile.set(uri, byKey);
        }
        // An empty set draws nothing — that is how it removes the type's bars.
        byKey.set(key, ranges);
        this.pushEditorDecorations(uri);
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
        for (const uri of this.editorDecorationsByFile.keys()) {
            this.editorDecorations.setGutterChangeDecorations(uri, []);
            this.editorDecorations.setExtensionTextDecorations(uri, []);
        }
    }

    public repushAll(): void {
        for (const uri of this.editorDecorationsByFile.keys()) this.pushEditorDecorations(uri);
        this.pushFileDecorations();
    }

    /**
     * Gutter bars of types with overviewRulerColor and text paint of types with backgroundColor/color, each a
     * full set for the resource; an empty set removes them. Types go in key (creation) order: a later one paints
     * over an earlier one.
     */
    private pushEditorDecorations(uri: string): void {
        const byKey = this.editorDecorationsByFile.get(uri);
        const gutter: IGutterChangeDecoration[] = [];
        const text: IExtensionTextDecoration[] = [];
        /* v8 ignore start -- defensive: pushEditorDecorations is only called for resources with an entry (setRanges/disposeType/repushAll) */
        // Stryker disable all: see v8 ignore above — unit tests can't reach the branch
        if (byKey === undefined) {
            this.editorDecorations.setGutterChangeDecorations(uri, gutter);
            this.editorDecorations.setExtensionTextDecorations(uri, text);
            return;
        }
        // Stryker restore all
        /* v8 ignore stop */
        const dark = isDarkKind(this.themeColorResolver.kind());
        for (const [key, ranges] of [...byKey].sort(([a], [b]) => a - b)) {
            const type = this.types.get(key);
            if (type === undefined) continue;
            this.collectGutter(type, ranges, gutter);
            const bg = this.resolveThemed(type.background, dark);
            const fg = this.resolveThemed(type.foreground, dark);
            if (bg === undefined && fg === undefined) continue;
            for (const range of ranges) {
                text.push({
                    range,
                    ...(bg === undefined ? {} : { bg }),
                    ...(fg === undefined ? {} : { fg }),
                    isWholeLine: type.isWholeLine,
                });
            }
        }
        this.editorDecorations.setGutterChangeDecorations(uri, gutter);
        this.editorDecorations.setExtensionTextDecorations(uri, text);
    }

    private collectGutter(type: IDecorationType, ranges: readonly IRange[], into: IGutterChangeDecoration[]): void {
        const colorId = type.overviewRulerColorId;
        // Stryker disable next-line ConditionalExpression: the resolver returns undefined for an unknown id — the color check below skips the type the same way
        if (colorId === undefined) return;
        const color = this.themeColorResolver.resolve(colorId);
        if (color === undefined) return;
        // VS Code's dirty-diff draws modified lines dashed, added/deleted solid.
        const dashed = colorId === "editorGutter.modifiedBackground";
        for (const range of ranges) into.push({ range, color, ...(dashed ? { dashed: true } : {}) });
    }

    /** The branch of the current theme kind, otherwise the type's own field; an unknown theme color id is no color. */
    private resolveThemed(color: IThemedDecorationColor, dark: boolean): number | undefined {
        const effective = (dark ? color.dark : color.light) ?? color.base;
        return typeof effective === "string" ? this.themeColorResolver.resolve(effective) : effective;
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
