import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import type { Uri } from "../../../../base/common/uri.ts";
import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IFileSystemProviderRegistry } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import type { IQuickDiffColors } from "./quickDiffDecorations.ts";
import { toGutterDecorations } from "./quickDiffDecorations.ts";

/** Максимум времени на один дифф; сверх — грубый результат вместо залипшего UI. */
const MAX_DIFF_COMPUTATION_MS = 1000;
/** Дефолт паузы перед пересчётом после правки (мс). */
const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Минимальный срез открытого редактора, нужный quick diff: ресурс, текст,
 * событие правки и канал gutter-декораций. `TextEditorPane` соответствует ему
 * структурно, связывание делает DI-модуль (образец — `DiagnosticsService`).
 */
export interface IQuickDiffEditor {
    readonly uri: Uri;
    getText(): string;
    onDidChangeContent(listener: () => void): IDisposable;
    setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void;
}

/** Поставщик открытых редакторов для {@link QuickDiffService}. */
export interface IQuickDiffEditorSource {
    getActiveEditor(): IQuickDiffEditor | null;
    onActiveEditorChanged(listener: (editor: IQuickDiffEditor | null) => void): IDisposable;
}

/**
 * Источник «оригинала» ресурса — аналог `QuickDiffProvider.provideOriginalResource`
 * из vscode API. Отдаёт URI версии, с которой сравнивать (у git это `git:`), либо
 * `null`, если сравнивать не с чем.
 *
 * Решение «есть ли у файла оригинал» принадлежит именно поставщику: untracked,
 * ignored, файл вне репозитория — всё это знает git, а не ядро. Ядро получает
 * ресурс и читает его через {@link IFileSystemProviderRegistry}, не зная про git.
 */
export interface IOriginalResourceProvider {
    /** `ref` — ревизия оригинала; не задан — `HEAD` (обычный quick diff). */
    provideOriginalResource(uri: Uri, ref?: string): Promise<Uri | null>;
}

export const QuickDiffEditorSourceDIToken = token<IQuickDiffEditorSource>("QuickDiffEditorSource");
export const OriginalResourceProviderDIToken = token<IOriginalResourceProvider>("OriginalResourceProvider");
export const QuickDiffServiceDIToken = token<QuickDiffService>("QuickDiffService");

/**
 * Живые change-bars в гуттере: дифф **буфера** против версии из git,
 * пересчитываемый по каждой правке (аналог `quickDiffModel.ts` в VS Code).
 *
 * До этого дифф считало git-расширение по файлу **на диске**, по
 * `onDidSaveTextDocument` — поэтому бары залипали до сохранения. Здесь текст
 * оригинала лежит в памяти, а сравнивается с ним живой буфер, так что бары
 * двигаются вместе с набором.
 *
 * Область — активный редактор: неактивные вкладки держат последний
 * посчитанный набор (их содержимое без фокуса не меняется), а при возврате
 * пересчитываются.
 */
export class QuickDiffService extends Disposable {
    public static dependencies = [
        QuickDiffEditorSourceDIToken,
        OriginalResourceProviderDIToken,
        FileSystemProviderRegistryDIToken,
        IConfigurationServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    private readonly computer = new DefaultLinesDiffComputer();
    /**
     * Текст оригинала по ресурсу редактора. Кэшируются ТОЛЬКО удачные чтения:
     * «оригинала нет» может означать и «SCM-расширение ещё не активировалось»,
     * а закэшировав такой ответ, мы бы навсегда остались без баров. Цена —
     * один дешёвый запрос к расширению на каждый пересчёт файла без оригинала.
     */
    private readonly originals = new Map<string, string>();
    private activeContentSubscription: IDisposable | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** Монотонный номер пересчёта: устаревший асинхронный ответ не применяется. */
    private computeSeq = 0;

    public constructor(
        private readonly editorSource: IQuickDiffEditorSource,
        private readonly originalResources: IOriginalResourceProvider,
        private readonly providers: IFileSystemProviderRegistry,
        private readonly configurationService: IConfigurationService,
        private readonly themeService: ThemeService,
    ) {
        super();

        this.register(
            this.editorSource.onActiveEditorChanged((editor) => {
                this.bindActiveEditor(editor);
                void this.refresh(editor);
            }),
        );
        // Сдвинулся HEAD/индекс — кэшированные оригиналы устарели.
        this.register(
            this.providers.onDidChangeFile(() => {
                this.originals.clear();
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        // SCM-расширение активируется асинхронно и обычно уже ПОСЛЕ открытия
        // первого файла: к моменту стартового пересчёта поставщика ещё нет.
        // Без этой подписки бары не появились бы до следующей правки.
        this.register(
            this.providers.onDidChangeProviders(() => {
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("git")) return;
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        // Смена темы меняет цвета баров: пере-резолвим и перекладываем.
        this.register(
            this.themeService.onThemeChange(() => {
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        this.register({
            dispose: () => {
                this.teardown();
            },
        });

        // Редактор мог стать активным до создания сервиса.
        const active = this.editorSource.getActiveEditor();
        this.bindActiveEditor(active);
        void this.refresh(active);
    }

    /** Пересчитывает бары активного редактора по правке — с паузой на серию нажатий. */
    private bindActiveEditor(editor: IQuickDiffEditor | null): void {
        this.activeContentSubscription?.dispose();
        this.activeContentSubscription =
            editor?.onDidChangeContent(() => {
                this.scheduleRefresh(editor);
            }) ?? null;
    }

    private scheduleRefresh(editor: IQuickDiffEditor): void {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.refresh(editor);
        }, this.debounceMs());
    }

    /**
     * Считает дифф и кладёт бары. Выключенная настройка и отсутствие оригинала
     * снимают бары — иначе на экране остался бы прошлый набор.
     */
    private async refresh(editor: IQuickDiffEditor | null): Promise<void> {
        if (editor === null) return;
        const seq = ++this.computeSeq;

        if (!this.isEnabled()) {
            editor.setGutterChangeDecorations([]);
            return;
        }

        const original = await this.originalText(editor.uri);
        // Пока ходили за оригиналом, мог смениться редактор или прийти новая
        // правка — устаревший ответ не применяем.
        if (seq !== this.computeSeq) return;
        if (original === null) {
            editor.setGutterChangeDecorations([]);
            return;
        }

        const diff = this.computer.computeDiff(original.split("\n"), editor.getText().split("\n"), {
            ignoreTrimWhitespace: false,
            maxComputationTimeMs: MAX_DIFF_COMPUTATION_MS,
            computeMoves: false,
        });
        editor.setGutterChangeDecorations(toGutterDecorations(diff.changes, this.colors()));
    }

    /** Текст оригинала с кэшированием удачных чтений; `null` — сравнивать не с чем. */
    private async originalText(uri: Uri): Promise<string | null> {
        const key = uri.toString();
        const cached = this.originals.get(key);
        if (cached !== undefined) return cached;

        const text = await this.loadOriginal(uri);
        if (text !== null) this.originals.set(key, text);
        return text;
    }

    private async loadOriginal(uri: Uri): Promise<string | null> {
        try {
            const originalResource = await this.originalResources.provideOriginalResource(uri);
            if (originalResource === null) return null;
            if (!this.providers.hasProvider(originalResource.scheme)) return null;
            return new TextDecoder().decode(await this.providers.readFile(originalResource));
        } catch {
            // Расширения нет, git недоступен, файла нет в ревизии — во всех
            // случаях показывать нечего, и это не повод шуметь.
            return null;
        }
    }

    private isEnabled(): boolean {
        return (
            this.configurationService.get<boolean>("git.enabled") !== false &&
            this.configurationService.get<boolean>("git.gutter.enabled") !== false
        );
    }

    private debounceMs(): number {
        const configured = this.configurationService.get<number>("git.refreshDebounce");
        if (configured === undefined || !Number.isFinite(configured) || configured < 0) return DEFAULT_DEBOUNCE_MS;
        return Math.min(configured, 5000);
    }

    private colors(): IQuickDiffColors {
        const theme = this.themeService.theme;
        const color = (id: keyof IWorkbenchColors): number => theme.getColor(id) ?? 0;
        return {
            added: color("editorGutter.addedBackground"),
            modified: color("editorGutter.modifiedBackground"),
            deleted: color("editorGutter.deletedBackground"),
        };
    }

    private teardown(): void {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.activeContentSubscription?.dispose();
    }
}
