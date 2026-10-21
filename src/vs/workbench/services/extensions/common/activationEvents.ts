// `workspaceContains:<glob>` точным сравнением не закрывается: аргумент сопоставляется
// с содержимым папок воркспейса (обход — `../node/workspaceContainsActivation.ts`).

import type {
    IExtensionContributions,
    IExtensionManifest,
} from "../../../../platform/extensions/common/iExtensionManifest.ts";

const WORKSPACE_CONTAINS_PREFIX = "workspaceContains:";

const ON_COMMAND_PREFIX = "onCommand:";

const ON_LANGUAGE_PREFIX = "onLanguage:";

/** Полный набор ({@link computeActivationEvents}): хост только сравнивает строки и про `contributes` не знает. */
export interface IActivationEventSource {
    readonly activationEvents?: readonly string[];
}

/** Как `activationEventsGenerator` у дескрипторов точек эталона. */
export interface IImplicitActivationEventGenerator {
    readonly point: keyof IExtensionContributions;
    generate(contributes: IExtensionContributions): Iterable<string>;
}

const NO_CONTRIBUTIONS: readonly never[] = [];

/** `commands` ⇒ `onCommand:<id>`: иначе видимая в палитре команда не-eager расширения была бы вечным no-op. */
export const IMPLICIT_ACTIVATION_EVENT_GENERATORS: readonly IImplicitActivationEventGenerator[] = [
    {
        point: "commands",
        *generate(contributes) {
            for (const command of contributes.commands ?? NO_CONTRIBUTIONS) {
                if (typeof command.command === "string") yield `${ON_COMMAND_PREFIX}${command.command}`;
            }
        },
    },
    {
        point: "languages",
        *generate(contributes) {
            for (const language of contributes.languages ?? NO_CONTRIBUTIONS) {
                if (typeof language.id === "string") yield `${ON_LANGUAGE_PREFIX}${language.id}`;
            }
        },
    },
    {
        point: "taskDefinitions",
        *generate(contributes) {
            for (const definition of contributes.taskDefinitions ?? NO_CONTRIBUTIONS) {
                if (typeof definition.type === "string" && definition.type !== "")
                    yield `onTaskType:${definition.type}`;
            }
        },
    },
];

/**
 * Голый `onUri` → `onUri:<id в нижнем регистре>` (`_readActivationEvents` эталона).
 * Отклонение: манифест без событий считается eager (`*`) — опубликованные расширения
 * (`test.tab-setter`) на это полагаются; снимается с обновлением их записей реестра
 * (docs/TODO/VscodeStructureFollowUps.md).
 */
export function computeActivationEvents(
    manifest: Pick<IExtensionManifest, "activationEvents" | "contributes">,
    extensionId: string,
): readonly string[] {
    const declared = (manifest.activationEvents ?? []).map((event) =>
        event === "onUri" ? `onUri:${extensionId.toLowerCase()}` : event,
    );
    const events = declared.length > 0 ? [...declared] : ["*"];
    const contributes = manifest.contributes ?? {};
    for (const generator of IMPLICIT_ACTIVATION_EVENT_GENERATORS) {
        for (const event of generator.generate(contributes)) {
            if (!events.includes(event)) events.push(event);
        }
    }
    return events;
}

export function readActivationEvents(source: IActivationEventSource): readonly string[] {
    return source.activationEvents ?? [];
}

/** Без дублей, в порядке манифеста. */
export function readCommandActivationIds(source: IActivationEventSource): readonly string[] {
    const ids: string[] = [];
    for (const event of readActivationEvents(source)) {
        if (!event.startsWith(ON_COMMAND_PREFIX)) continue;
        const id = event.slice(ON_COMMAND_PREFIX.length);
        if (id !== "" && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/**
 * Две семантики одного префикса, как `checkActivateWorkspaceContainsExtension` эталона: сводить
 * к поиску нельзя — `.vscode` срабатывает и на каталоге, а `pom.xml` не обязан читать дерево.
 */
export interface IWorkspaceContainsPatterns {
    /** Без `*`/`?` — проверка существования пути (файл ИЛИ каталог). */
    readonly paths: readonly string[];
    readonly globs: readonly string[];
}

export const NO_WORKSPACE_CONTAINS_PATTERNS: IWorkspaceContainsPatterns = { paths: [], globs: [] };

export function hasWorkspaceContainsPatterns(patterns: IWorkspaceContainsPatterns): boolean {
    return patterns.paths.length > 0 || patterns.globs.length > 0;
}

/** Пустой паттерн отброшен: как путь он указывал бы на папку воркспейса и матчил любой воркспейс. */
export function readWorkspaceContainsPatterns(source: IActivationEventSource): IWorkspaceContainsPatterns {
    const paths: string[] = [];
    const globs: string[] = [];
    for (const event of readActivationEvents(source)) {
        if (!event.startsWith(WORKSPACE_CONTAINS_PREFIX)) continue;
        const pattern = event.slice(WORKSPACE_CONTAINS_PREFIX.length);
        if (pattern === "") continue;
        const sink = pattern.includes("*") || pattern.includes("?") ? globs : paths;
        if (!sink.includes(pattern)) sink.push(pattern);
    }
    return { paths, globs };
}
