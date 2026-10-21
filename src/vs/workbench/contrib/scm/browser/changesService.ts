import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Набор пушит расширение, команду регистрирует ядро — обратная сторона {@link ORIGINAL_RESOURCE_COMMAND}. */
export const PUBLISH_CHANGES_COMMAND = "diode.scm.publishChanges";

/**
 * Как resource groups VS Code; untracked показывается под «Changes» (`scmChangeGroups.ts`).
 * Файл `MM` приходит двумя записями: в `index` и в `worktree`.
 */
export type ScmGroupId = "merge" | "index" | "worktree" | "untracked";

/** Порядок — порядок показа (как в VS Code). */
export const SCM_GROUP_IDS: readonly ScmGroupId[] = ["merge", "index", "worktree", "untracked"];

export interface IScmChange {
    readonly uri: Uri;
    readonly status: string;
    /** Отдельно от `status`: буква `U` у untracked и у конфликта, различает их только цвет. */
    readonly colorId: string;
    /**
     * Относительно корня репозитория, через `/`. Считает расширение: сопоставлять абсолютные
     * пути на стороне ядра ненадёжно (Windows: 8.3-имена, регистр диска). Пусто — basename.
     */
    readonly path: string;
    readonly group: ScmGroupId;
}

export const ScmChangesServiceDIToken = token<ScmChangesService>("ScmChangesService");

/**
 * Транспорт — команда, а не `scm`-неймспейс: в `vscode.d.ts` он ещё закомментирован
 * (docs/TODO/Diff.md). Переход на `scm` заменит источник, а не этот сервис.
 */
export class ScmChangesService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private changeList: readonly IScmChange[] = [];
    /** Гасит повторную публикацию того же набора. */
    private signature = "";
    private readonly onDidChangeChangesEmitter = this.register(new Emitter<void>());

    public constructor(commands: CommandRegistry) {
        super();
        this.register(
            commands.register(PUBLISH_CHANGES_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
    }

    /** В порядке прихода от расширения. */
    public get changes(): readonly IScmChange[] {
        return this.changeList;
    }

    public readonly onDidChangeChanges = this.onDidChangeChangesEmitter.event;

    /** Не-массив — пустой набор, мусорные записи отбрасываются. */
    private publish(payload: unknown): void {
        const changes = parseChanges(payload);
        // Расширение публикует набор на каждый refresh (и на смену активного редактора):
        // без гашения вкладка Changes пересобиралась бы вхолостую.
        const signature = changes
            .map((c) => `${c.uri.toString()}\t${c.status}\t${c.colorId}\t${c.path}\t${c.group}`)
            .join("\n");
        if (signature === this.signature) return;
        this.signature = signature;
        this.changeList = changes;
        this.onDidChangeChangesEmitter.fire();
    }
}

function parseChanges(payload: unknown): IScmChange[] {
    if (!Array.isArray(payload)) return [];
    const changes: IScmChange[] = [];
    for (const raw of payload) {
        if (typeof raw !== "object" || raw === null) continue;
        const { uri, status, colorId, path, group } = raw as {
            uri?: unknown;
            status?: unknown;
            colorId?: unknown;
            path?: unknown;
            group?: unknown;
        };
        if (typeof uri !== "string" || uri === "" || typeof status !== "string") continue;
        // Группа обязательна и строго из enum — команды staging решают
        // применимость по ней, запись с мусорной группой опаснее пропущенной.
        if (!SCM_GROUP_IDS.includes(group as ScmGroupId)) continue;
        changes.push({
            uri: Uri.parse(uri),
            status,
            colorId: typeof colorId === "string" ? colorId : "",
            path: typeof path === "string" ? path : "",
            group: group as ScmGroupId,
        });
    }
    return changes;
}
