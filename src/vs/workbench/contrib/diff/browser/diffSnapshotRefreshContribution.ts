import { Disposable } from "@tuidom/all/common/disposable";
import type { Uri } from "../../../../base/common/uri.ts";
import type { DiffSide } from "../../../../editor/common/diff/diffSide.ts";
import type { IFileSystemProviderRegistry } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { refreshDiffSnapshots } from "./openDiffPair.ts";

export const DiffSnapshotRefreshContributionDIToken = token<DiffSnapshotRefreshContribution>(
    "DiffSnapshotRefreshContribution",
);

/** Пауза на серию событий провайдера (git шевелит `.git` пачками при rebase/commit). */
const REFRESH_DEBOUNCE_MS = 200;

/**
 * US-31: живые снимочные стороны дифф-вкладок. Живые (file-) стороны диффа v2
 * обновляются сами через общие модели, а снимки (`git:`-ревизия) — только
 * повторным вызовом команды. Эта контрибуция слушает `onDidChangeFile` реестра
 * провайдеров (git-расширение фаерит по ресурсам, которые у него читали: HEAD
 * сдвинулся коммитом из терминала — US-31) и освежает снимочные стороны
 * открытых дифф-вкладок, чьи ресурсы затронуты. Неизменившийся текст панель
 * отбрасывает сама (no-op — каретка и скролл не сбрасываются зря).
 */
export class DiffSnapshotRefreshContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, FileSystemProviderRegistryDIToken] as const;

    /** Накопленные изменённые ресурсы до срабатывания debounce. */
    private readonly pending = new Set<string>();
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** Монотонный номер прогона: устаревшие асинхронные чтения не перетирают свежие. */
    private refreshSeq = 0;

    public constructor(
        private readonly editors: EditorService,
        private readonly providers: IFileSystemProviderRegistry,
    ) {
        super();
        this.register(
            this.providers.onDidChangeFile((uris) => {
                this.schedule(uris);
            }),
        );
        this.register({
            dispose: () => {
                if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
            },
        });
    }

    private schedule(uris: readonly Uri[]): void {
        for (const uri of uris) this.pending.add(uri.toString());
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.flush();
        }, REFRESH_DEBOUNCE_MS);
    }

    private async flush(): Promise<void> {
        const changed = new Set(this.pending);
        this.pending.clear();
        const seq = ++this.refreshSeq;

        for (const group of this.editors.groups) {
            for (const pane of group.getPanes()) {
                if (!(pane instanceof DiffEditorPane2)) continue;
                if (!pane.snapshotSides().some((side) => this.sideTouched(pane, side, changed))) continue;
                await refreshDiffSnapshots(this.providers, pane);
                /* v8 ignore start -- гонка «новая пачка пришла, пока читали» детерминированно
                   не воспроизводится юнитом: её прогон уже запланирован, наш — устарел */
                if (seq !== this.refreshSeq) return;
                /* v8 ignore stop */
            }
        }
    }

    /** Ресурс стороны (настоящий, из входа команды — не синтетический модели). */
    private sideTouched(pane: DiffEditorPane2, side: DiffSide, changed: ReadonlySet<string>): boolean {
        const uri = side === "original" ? pane.originalUri : pane.modifiedUri;
        return uri !== null && changed.has(uri.toString());
    }
}
