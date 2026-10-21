import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import type { IQuickDiffColors } from "./quickDiffDecorations.ts";
import { toGutterDecorations } from "./quickDiffDecorations.ts";

/** Максимум времени на один дифф; сверх — грубый результат вместо залипшего UI. */
const MAX_DIFF_COMPUTATION_MS = 1000;
const DEFAULT_DEBOUNCE_MS = 200;

/** `TextEditorPane` соответствует структурно, связывание делает DI-модуль. */
export interface IQuickDiffEditor {
    readonly uri: Uri;
    /** Не строка всего текста: пересчёт идёт на каждую правку. */
    getLinesContent(): string[];
    onDidChangeContent(listener: () => void): IDisposable;
    setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void;
}

export interface IQuickDiffEditorSource {
    getActiveEditor(): IQuickDiffEditor | null;
    onActiveEditorChanged(listener: (editor: IQuickDiffEditor | null) => void): IDisposable;
}

/**
 * Аналог `QuickDiffProvider.provideOriginalResource`. Есть ли у файла оригинал, решает
 * поставщик: untracked, ignored, вне репозитория — это знает git, а не ядро.
 */
export interface IOriginalResourceProvider {
    /** `ref` — ревизия оригинала; не задан — `HEAD` (обычный quick diff). */
    provideOriginalResource(uri: Uri, ref?: string): Promise<Uri | null>;
}

export const QuickDiffEditorSourceDIToken = token<IQuickDiffEditorSource>("QuickDiffEditorSource");
export const OriginalResourceProviderDIToken = token<IOriginalResourceProvider>("OriginalResourceProvider");
export const QuickDiffServiceDIToken = token<QuickDiffService>("QuickDiffService");

/**
 * Дифф буфера (не файла на диске) против версии из git, по каждой правке — аналог
 * `quickDiffModel.ts`. Неактивные вкладки держат последний набор и пересчитываются при возврате.
 */
export class QuickDiffService extends Disposable {
    public static dependencies = [
        QuickDiffEditorSourceDIToken,
        OriginalResourceProviderDIToken,
        IFileServiceDIToken,
        IConfigurationServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    private readonly computer = new DefaultLinesDiffComputer();
    /**
     * Кэшируются только удачные чтения: «оригинала нет» может значить «SCM-расширение ещё
     * не активировалось», и закэшированный ответ оставил бы файл без баров навсегда.
     */
    private readonly originals = new Map<string, string[]>();
    private activeContentSubscription: IDisposable | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly latest = new LatestRequest();

    public constructor(
        private readonly editorSource: IQuickDiffEditorSource,
        private readonly originalResources: IOriginalResourceProvider,
        private readonly providers: IFileService,
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
            this.providers.onDidFilesChange(() => {
                this.originals.clear();
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        // SCM-расширение активируется обычно уже после открытия первого файла —
        // без этой подписки бары не появились бы до следующей правки.
        this.register(
            this.providers.onDidChangeFileSystemProviderRegistrations(() => {
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("git")) return;
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
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

    /** Выключенная настройка и отсутствие оригинала снимают бары — иначе остался бы прошлый набор. */
    private async refresh(editor: IQuickDiffEditor | null): Promise<void> {
        if (editor === null) return;
        const ticket = this.latest.start();

        if (!this.isEnabled()) {
            editor.setGutterChangeDecorations([]);
            return;
        }

        const original = await this.originalLines(editor.uri);
        if (ticket.isStale()) return;
        if (original === null) {
            editor.setGutterChangeDecorations([]);
            return;
        }

        const diff = this.computer.computeDiff(original, editor.getLinesContent(), {
            ignoreTrimWhitespace: false,
            maxComputationTimeMs: MAX_DIFF_COMPUTATION_MS,
            computeMoves: false,
        });
        editor.setGutterChangeDecorations(toGutterDecorations(diff.changes, this.colors()));
    }

    private async originalLines(uri: Uri): Promise<string[] | null> {
        const key = uri.toString();
        const cached = this.originals.get(key);
        if (cached !== undefined) return cached;

        const text = await this.loadOriginal(uri);
        if (text === null) return null;
        const lines = text.split("\n");
        this.originals.set(key, lines);
        return lines;
    }

    private async loadOriginal(uri: Uri): Promise<string | null> {
        try {
            const originalResource = await this.originalResources.provideOriginalResource(uri);
            if (originalResource === null) return null;
            // Схема без провайдера — отказ readFile (Unavailable), ловится ниже.
            return new TextDecoder().decode((await this.providers.readFile(originalResource)).value);
        } catch {
            // Расширения нет, git недоступен, файла нет в ревизии — показывать нечего, не шумим.
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
