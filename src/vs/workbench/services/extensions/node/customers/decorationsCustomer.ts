import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorDecorationsService } from "../../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../../api/common/iThemeColorResolver.ts";
import type { IWireColorTheme, SerializedDecorationRenderOptions } from "../../../../api/common/wireTypes.ts";
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
        // overviewRulerColor makes the type a gutter change bar.
        store.add(
            rpc.handleNotification("window.createTextEditorDecorationType", (params) => {
                const p: { key?: unknown; options?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: a type with a non-numeric key is unobservable — setDecorations, which has its own key guard, never reaches it
                if (typeof p.key !== "number") return;
                // A non-object in options carries no fields — a type without a gutter color.
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
                this.live = null;
            },
        });
        return store;
    }
}

class SpawnDecorations {
    /** `undefined` means the type doesn't paint the gutter. */
    private readonly types = new Map<number, string | undefined>();
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
        this.types.set(key, themeColorIdOf(options.overviewRulerColor));
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

    public repushAll(): void {
        for (const uri of this.editorDecorationsByFile.keys()) this.pushEditorDecorations(uri);
        this.pushFileDecorations();
    }

    /** Gutter types only (those with overviewRulerColor); an empty set removes the bars. */
    private pushEditorDecorations(uri: string): void {
        const byKey = this.editorDecorationsByFile.get(uri);
        const decorations: IGutterChangeDecoration[] = [];
        /* v8 ignore start -- defensive: pushEditorDecorations is only called for resources with an entry (setRanges/disposeType/repushAll) */
        // Stryker disable all: see v8 ignore above — unit tests can't reach the branch
        if (byKey === undefined) {
            this.editorDecorations.setGutterChangeDecorations(uri, decorations);
            return;
        }
        // Stryker restore all
        /* v8 ignore stop */
        for (const [key, ranges] of byKey) {
            const colorId = this.types.get(key);
            // Stryker disable next-line ConditionalExpression: the resolver returns undefined for an unknown id — the color check below skips the type the same way
            if (colorId === undefined) continue;
            const color = this.themeColorResolver.resolve(colorId);
            if (color === undefined) continue;
            // VS Code's dirty-diff draws modified lines dashed, added/deleted solid.
            const dashed = colorId === "editorGutter.modifiedBackground";
            for (const range of ranges) decorations.push({ range, color, ...(dashed ? { dashed: true } : {}) });
        }
        this.editorDecorations.setGutterChangeDecorations(uri, decorations);
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
