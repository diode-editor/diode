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

/** Time limit for one diff; beyond it a coarse result instead of a frozen UI. */
const MAX_DIFF_COMPUTATION_MS = 1000;
const DEFAULT_DEBOUNCE_MS = 200;

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface IQuickDiffEditor {
    readonly uri: Uri;
    /**
     * The large-file mode (docs/arch/Editor.md): no bars, like upstream above its sync limit, where the
     * diff worker never sees the model. The event fires when the mode is left ("Enable Editing").
     */
    readonly isTooLargeForTokenization: boolean;
    /** Not a whole-text string: recompute runs on every edit. */
    getLinesContent(): string[];
    onDidChangeContent(listener: () => void): IDisposable;
    onDidChangeTooLargeForTokenization(listener: () => void): IDisposable;
    setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void;
}

export interface IQuickDiffEditorSource {
    getActiveEditor(): IQuickDiffEditor | null;
    onActiveEditorChanged(listener: (editor: IQuickDiffEditor | null) => void): IDisposable;
}

/**
 * Counterpart of `QuickDiffProvider.provideOriginalResource`. The provider decides whether a file has an
 * original: untracked, ignored, outside the repository — git knows that, not the core.
 */
export interface IOriginalResourceProvider {
    /** `ref` is the original's revision; when unset, `HEAD` (plain quick diff). */
    provideOriginalResource(uri: Uri, ref?: string): Promise<Uri | null>;
}

export const QuickDiffEditorSourceDIToken = token<IQuickDiffEditorSource>("QuickDiffEditorSource");
export const OriginalResourceProviderDIToken = token<IOriginalResourceProvider>("OriginalResourceProvider");
export const QuickDiffServiceDIToken = token<QuickDiffService>("QuickDiffService");

/**
 * Diffs the buffer (not the file on disk) against the git version on every edit — counterpart of
 * `quickDiffModel.ts`. Inactive tabs keep their last set and recompute when reactivated.
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
     * Only successful reads are cached: "no original" may mean "the SCM extension has not activated
     * yet", and a cached answer would leave the file without bars forever.
     */
    private readonly originals = new Map<string, string[]>();
    private activeContentSubscription: IDisposable | null = null;
    private activeModeSubscription: IDisposable | null = null;
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
        // HEAD/index moved — cached originals are stale.
        this.register(
            this.providers.onDidFilesChange(() => {
                this.originals.clear();
                void this.refresh(this.editorSource.getActiveEditor());
            }),
        );
        // The SCM extension usually activates after the first file is opened —
        // without this subscription bars would not appear until the next edit.
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

        // The editor may have become active before the service was created.
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
        this.activeModeSubscription?.dispose();
        this.activeModeSubscription =
            // Stryker disable next-line LogicalOperator: a subscription is an object, "||" cannot tell it from "??"
            editor?.onDidChangeTooLargeForTokenization(() => {
                void this.refresh(editor);
            }) ?? null;
    }

    private scheduleRefresh(editor: IQuickDiffEditor): void {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.refresh(editor);
        }, this.debounceMs());
    }

    /** A disabled setting or a missing original clears the bars — otherwise the previous set would remain. */
    private async refresh(editor: IQuickDiffEditor | null): Promise<void> {
        if (editor === null) return;
        const ticket = this.latest.start();

        if (!this.isEnabled() || editor.isTooLargeForTokenization) {
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
            // A scheme without a provider fails readFile (Unavailable), caught below.
            return new TextDecoder().decode((await this.providers.readFile(originalResource)).value);
        } catch {
            // No extension, git unavailable, file not in the revision — nothing to show, stay quiet.
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
        this.activeModeSubscription?.dispose();
    }
}
