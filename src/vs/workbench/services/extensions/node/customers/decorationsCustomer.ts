import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type { IGutterChangeDecoration } from "../../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IEditorDecorationsService } from "../../../../api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../../../api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../../../api/common/iThemeColorResolver.ts";
import {
    type IWireColorTheme,
    parseDecorationRanges,
    parseWireFileDecorations,
    type SerializedDecorationRenderOptions,
    themeColorIdOf,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/**
 * Декорации расширений (gutter change-bar'ы в редакторе и бейджи/цвета файлов
 * в дереве) и активная тема. Реестр типов декораций и держимые наборы живут
 * ровно один спавн: респавн начинает с чистого листа (сами поверхности
 * перерисует расширение). Подписка на смену темы — на всё время жизни хоста,
 * но пере-резолв декораций и новая тема уходят только живому спавну.
 */
export class DecorationsCustomer extends Disposable implements IExtensionHostCustomer {
    private live: { readonly rpc: HostRpc; readonly decorations: SpawnDecorations } | null = null;

    public constructor(
        private readonly editorDecorations: IEditorDecorationsService,
        private readonly fileDecorations: IFileDecorationsService,
        private readonly themeColorResolver: IThemeColorResolver,
    ) {
        super();
        // Смена темы → пере-резолв держимых декораций в обе поверхности + новая
        // тема расширениям (`window.onDidChangeActiveColorTheme`).
        this.register(
            themeColorResolver.onDidChange(() => {
                this.live?.decorations.repushAll();
                this.pushActiveColorTheme();
            }),
        );
    }

    /**
     * Шлёт субпроцессу вид активной темы. Молча ничего не делает, пока
     * субпроцесса нет: тема приедет семенем на его подъёме, и досылать её
     * мёртвому некому.
     */
    public pushActiveColorTheme(): void {
        const theme: IWireColorTheme = { kind: this.themeColorResolver.kind() };
        this.live?.rpc.notify("window.themeChanged", theme);
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const decorations = new SpawnDecorations(this.editorDecorations, this.fileDecorations, this.themeColorResolver);
        this.live = { rpc, decorations };
        const store = new DisposableStore();
        // Субпроцесс завёл тип декорации. Регистрируем его форму: наличие
        // overviewRulerColor делает тип gutter change-bar'ом.
        store.add(
            rpc.handleNotification("window.createTextEditorDecorationType", (params) => {
                const p: { key?: unknown; options?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: тип с нечисловым ключом ненаблюдаем — до него не доберётся setDecorations, у которого свой гард ключа
                if (typeof p.key !== "number") return;
                // Не-объект в options полей не несёт — тип без gutter-цвета.
                const options = (p.options ?? {}) as SerializedDecorationRenderOptions;
                decorations.createType(p.key, options);
            }),
        );
        // Тип снят — гасим его декорации во всех файлах и пере-push.
        store.add(
            rpc.handleNotification("window.disposeTextEditorDecorationType", (params) => {
                const p: { key?: unknown } = params;
                // Stryker disable next-line ConditionalExpression: снятие нечислового ключа — no-op: такого ключа нет ни в реестре, ни в наборах файлов
                if (typeof p.key !== "number") return;
                decorations.disposeType(p.key);
            }),
        );
        // Набор диапазонов типа в ресурсе. Пере-резолвим ThemeColor и проталкиваем
        // gutter-декорации в редактор(ы) этого ресурса.
        store.add(
            rpc.handleNotification("editor.setDecorations", (params) => {
                const p: { key?: unknown; uri?: unknown; ranges?: unknown } = params;
                if (typeof p.key !== "number" || typeof p.uri !== "string") return;
                decorations.setRanges(p.key, p.uri, parseDecorationRanges(p.ranges));
            }),
        );
        // Изменившиеся файловые декорации. Мержим в держимый набор (голый uri без
        // цвета/бейджа = снятие) и пере-push всего набора в дерево.
        store.add(
            rpc.handleNotification("window.fileDecorationsChanged", (params) => {
                const p: { decorations?: unknown } = params;
                decorations.mergeFileDecorations(parseWireFileDecorations(p.decorations));
            }),
        );
        // Следующий спавн подключается только после ухода этого, так что
        // снимать можно без сверки «а наш ли живой».
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }
}

/** Реестр типов и держимые наборы декораций одного спавна. */
class SpawnDecorations {
    /** Тип декорации → id цвета gutter-бара; `undefined` — тип не красит гуттер. */
    private readonly types = new Map<number, string | undefined>();
    private readonly editorDecorationsByFile = new Map<string, Map<number, readonly IRange[]>>();
    private readonly fileDecorationState = new Map<
        string,
        { badge: string | undefined; colorId: string | undefined }
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
        // Пустой набор ничего не рисует — он и снимает бары типа.
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
                this.fileDecorationState.set(filePath, { badge: d.badge, colorId: d.colorId });
            }
        }
        this.pushFileDecorations();
    }

    /** Пере-push всех держимых декораций в обе поверхности (на смену темы). */
    public repushAll(): void {
        for (const uri of this.editorDecorationsByFile.keys()) this.pushEditorDecorations(uri);
        this.pushFileDecorations();
    }

    /**
     * Схлопывает держимые декорации файла в gutter change-bar'ы (только
     * gutter-типы — есть overviewRulerColor) с пере-резолвом ThemeColor и
     * проталкивает их в редактор(ы) этого ресурса. Пустой набор снимает бары.
     */
    private pushEditorDecorations(uri: string): void {
        const byKey = this.editorDecorationsByFile.get(uri);
        const decorations: IGutterChangeDecoration[] = [];
        /* v8 ignore start -- defensive: pushEditorDecorations зовётся только для ресурсов с записью (setRanges/disposeType/repushAll) */
        // Stryker disable all: см. v8 ignore выше — ветку юнит не достаёт
        if (byKey === undefined) {
            this.editorDecorations.setGutterChangeDecorations(uri, decorations);
            return;
        }
        // Stryker restore all
        /* v8 ignore stop */
        for (const [key, ranges] of byKey) {
            const colorId = this.types.get(key);
            // Stryker disable next-line ConditionalExpression: резолвер на неизвестный id отдаёт undefined — проверка цвета ниже пропустит тип так же
            if (colorId === undefined) continue;
            const color = this.themeColorResolver.resolve(colorId);
            if (color === undefined) continue;
            // VS Code's dirty-diff draws modified lines dashed, added/deleted solid.
            const dashed = colorId === "editorGutter.modifiedBackground";
            for (const range of ranges) decorations.push({ range, color, ...(dashed ? { dashed: true } : {}) });
        }
        this.editorDecorations.setGutterChangeDecorations(uri, decorations);
    }

    /** Пере-резолвит держимые файловые декорации и проталкивает полный набор в дерево. */
    private pushFileDecorations(): void {
        const entries: { path: string; color?: number; badge?: string }[] = [];
        for (const [path, { badge, colorId }] of this.fileDecorationState) {
            // Stryker disable next-line ConditionalExpression: резолвер на неизвестный (в т.ч. пустой) id отдаёт undefined — цвета нет в обоих случаях
            const color = colorId === undefined ? undefined : this.themeColorResolver.resolve(colorId);
            entries.push({
                path,
                ...(color === undefined ? {} : { color }),
                ...(badge === undefined ? {} : { badge }),
            });
        }
        this.fileDecorations.setFileDecorations(entries);
    }
}

/**
 * Переводит wire-uri файловой декорации в абсолютный путь; `null` — если ресурс
 * не на диске. Субпроцесс шлёт `Uri.toString()`, разбираем тем же типом.
 *
 * Раньше не-file строки возвращались как есть («best-effort»), и схема уезжала в
 * ключ `fileDecorationState` (`git:/foo.ts?{...}`), где молча не совпадала ни с
 * одним путём дерева. Декорацию для не-file ресурса честнее отбросить: дерево
 * адресуется путями, показать там `git:`-ресурс всё равно нечем.
 */
function fileUriToPath(uri: string): string | null {
    const parsed = Uri.parse(uri);
    return parsed.scheme === "file" ? parsed.fsPath : null;
}
