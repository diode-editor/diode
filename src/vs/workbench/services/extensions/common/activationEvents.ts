/**
 * Чтение `activationEvents` расширения — один разбор на всех потребителей
 * активации (`ExtensionHost`).
 *
 * Событие в манифесте — строка вида `<вид>` или `<вид>:<аргумент>`. Точным
 * сравнением закрываются только виды без аргумента (`*`, `onStartupFinished`) и
 * те, где аргумент приходит от вызывающего (`onLanguage:<id>`, `onCommand:<id>`).
 * `workspaceContains:<glob>` так не закрывается: его аргумент надо сопоставлять
 * с содержимым папок воркспейса — разбор паттернов живёт здесь, сам обход в
 * `../node/workspaceContainsActivation.ts`.
 */

import type {
    IExtensionContributions,
    IExtensionManifest,
} from "../../../../platform/extensions/common/iExtensionManifest.ts";

/** «В открытой папке воркспейса есть файл по паттерну». */
const WORKSPACE_CONTAINS_PREFIX = "workspaceContains:";

/** «Исполнили команду с таким id». */
const ON_COMMAND_PREFIX = "onCommand:";

/** «Модели понадобились фичи этого языка». */
const ON_LANGUAGE_PREFIX = "onLanguage:";

/**
 * Регистрация, из которой читаются события активации: ПОЛНЫЙ набор,
 * посчитанный при её сборке ({@link computeActivationEvents}). Хост только
 * сравнивает строки и про `contributes` не знает.
 */
export interface IActivationEventSource {
    readonly activationEvents?: readonly string[];
}

/**
 * Генератор неявных событий одной точки расширения (как `activationEventsGenerator`
 * у дескрипторов точек эталона): из вклада `contributes.<point>` — события, по
 * которым расширение поднимается, даже если само их не объявляло.
 */
export interface IImplicitActivationEventGenerator {
    readonly point: keyof IExtensionContributions;
    generate(contributes: IExtensionContributions): Iterable<string>;
}

/** Пустой вклад — точка не заявлена. */
const NO_CONTRIBUTIONS: readonly never[] = [];

/**
 * Явный список генераторов (без синглтон-реестра с саморегистрацией):
 * - `commands` ⇒ `onCommand:<id>` — иначе видимая в палитре команда не-eager
 *   расширения была бы вечным no-op;
 * - `languages` ⇒ `onLanguage:<id>` — расширение, принёсшее язык, встаёт на нём;
 * - `taskDefinitions` ⇒ `onTaskType:<type>` — провайдер задач встаёт, когда
 *   Run Task спрашивает задачи его типа.
 *
 * Генераторы для поверхностей, которых у нас нет (`onView`, `onUri`, …),
 * появятся вместе с поверхностью.
 */
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
        // Тип задачи ⇒ `onTaskType:<type>` (`activationEventsGenerator` у
        // `taskDefinitions` эталона): Run Task поднимает провайдера по типу.
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
 * Полный набор событий активации расширения: объявленные в манифесте плюс
 * неявные от генераторов, без повторов.
 *
 * **Отклонение от эталона — дефолт `*`:** манифест без событий (пусто или нет
 * поля) считается eager. У vscode пусто значит пусто, но в нашем магазине уже
 * опубликованы расширения, которые на этот дефолт полагаются (`test.tab-setter`
 * без `activationEvents`), и эталонный дефолт молча выключил бы их у
 * пользователей. Снимается вместе с обновлением этих записей реестра (см.
 * `docs/TODO/VscodeStructureFollowUps.md`).
 */
export function computeActivationEvents(
    manifest: Pick<IExtensionManifest, "activationEvents" | "contributes">,
): readonly string[] {
    const declared = manifest.activationEvents ?? [];
    const events = declared.length > 0 ? [...declared] : ["*"];
    const contributes = manifest.contributes ?? {};
    for (const generator of IMPLICIT_ACTIVATION_EVENT_GENERATORS) {
        for (const event of generator.generate(contributes)) {
            if (!events.includes(event)) events.push(event);
        }
    }
    return events;
}

/** События активации регистрации (см. {@link IActivationEventSource}). */
export function readActivationEvents(source: IActivationEventSource): readonly string[] {
    return source.activationEvents ?? [];
}

/**
 * id команд, по исполнению которых расширение обязано активироваться —
 * `onCommand:<id>` из манифеста плюс неявные из `contributes.commands`
 * (см. {@link computeActivationEvents}). Без дублей; порядок — манифестный.
 */
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
 * Паттерны `workspaceContains:` расширения, разведённые по СЕМАНТИКЕ. У одного
 * префикса их две (и в эталоне тоже — `checkActivateWorkspaceContainsExtension`):
 * паттерн без glob-символов — это простая проверка существования пути
 * относительно каждой папки воркспейса, паттерн с ними уходит в поиск по дереву.
 * Сводить обе к поиску нельзя: `workspaceContains:.vscode` должен срабатывать и
 * на каталоге, а `workspaceContains:pom.xml` не обязан читать дерево вообще.
 */
export interface IWorkspaceContainsPatterns {
    /** Без `*`/`?` — проверка существования пути (файл ИЛИ каталог). */
    readonly paths: readonly string[];
    /** С `*`/`?` — поиск файла по дереву. */
    readonly globs: readonly string[];
}

/** Пустой набор — расширение про `workspaceContains:` ничего не говорило. */
export const NO_WORKSPACE_CONTAINS_PATTERNS: IWorkspaceContainsPatterns = { paths: [], globs: [] };

/** Есть ли в наборе хоть один паттерн (иначе считать нечего). */
export function hasWorkspaceContainsPatterns(patterns: IWorkspaceContainsPatterns): boolean {
    return patterns.paths.length > 0 || patterns.globs.length > 0;
}

/**
 * Разбирает `workspaceContains:`-события источника на два стока
 * {@link IWorkspaceContainsPatterns}. Пустой паттерн (`workspaceContains:`)
 * отбрасывается: как «путь» он указывал бы на саму папку воркспейса и матчил
 * любой воркспейс.
 */
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
