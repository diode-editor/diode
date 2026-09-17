import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";

import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import { isExcluded } from "./chokidarTreeWatcher.ts";

/** Один живой обход дерева и все запросы, которые на нём едут. */
interface ITraversal {
    readonly root: string;
    readonly recursive: boolean;
    readonly excludes: readonly string[];
    /** Отсортированные excludes — ключ сравнения, считается один раз на обход. */
    readonly excludesKey: string;
    readonly subscribers: Set<ISubscriber>;
    /** Подписка на делегата — тот самый живой обход, который мы делим. */
    readonly subscription: IDisposable;
}

interface ISubscriber {
    readonly base: string;
    readonly recursive: boolean;
    readonly onChanges: (changes: readonly ITreeFileChange[]) => void;
    disposed: boolean;
}

/**
 * Декоратор над {@link ITreeFileWatcher}, который не заводит второй обход там,
 * где хватает уже живого.
 *
 * Обход дерева — самый дорогой ресурс редактора на старте: полный рекурсивный
 * `readdir` плюс по inotify-watch'у на каждый каталог. Пока запрос один, цена
 * платится один раз; но их не один — встроенный git просит три (корень +
 * `.git` + `.git/refs/...`), и каждый LSP-клиент с `DidChangeWatchedFiles`
 * добавляет свои. Без этого слоя цена умножается на число запросов, и на
 * типовом дереве вторая-третья волна подписок упирается в лимит inotify.
 *
 * Идея — та же, что у watcher-процесса VS Code: запрос, чьё поддерево уже
 * целиком покрыто живым рекурсивным обходом, подписывается на его поток
 * событий вместо своего `chokidar.watch`. Поток фильтруется под каждого
 * подписчика (только пути под его базой; нерекурсивному — только прямые дети),
 * так что снаружи поведение неотличимо от независимых watcher'ов.
 *
 * Коалесинг остаётся у делегата и происходит **один раз на обход**, а не на
 * подписчика.
 */
export class SharedTreeWatcher implements ITreeFileWatcher {
    private readonly traversals = new Set<ITraversal>();

    public constructor(
        private readonly delegate: ITreeFileWatcher,
        private readonly logger?: ILogger,
    ) {}

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        // Нормализация до сравнения: `/repo/` и `/repo/./src/..` — один и тот же
        // корень, а «предок/потомок» считается по строкам.
        const base = path.resolve(rootPath);
        const subscriber: ISubscriber = { base, recursive: options.recursive, onChanges, disposed: false };
        const traversal = this.findReusable(base, options) ?? this.createTraversal(base, options);
        traversal.subscribers.add(subscriber);
        return {
            dispose: () => {
                if (subscriber.disposed) return; // повторный dispose — no-op
                subscriber.disposed = true;
                traversal.subscribers.delete(subscriber);
                if (traversal.subscribers.size > 0) return;
                this.traversals.delete(traversal);
                traversal.subscription.dispose();
            },
        };
    }

    /** Живой обход, на котором запрос может поехать без потери событий, либо `undefined`. */
    private findReusable(base: string, options: ITreeFileWatchOptions): ITraversal | undefined {
        const excludesKey = toExcludesKey(options.excludes);
        for (const traversal of this.traversals) {
            if (traversal.excludesKey !== excludesKey) continue;
            if (!covers(traversal, base, options.recursive)) continue;
            this.logger?.trace("reusing an existing tree watcher", { root: traversal.root, base });
            return traversal;
        }
        return undefined;
    }

    private createTraversal(base: string, options: ITreeFileWatchOptions): ITraversal {
        const { recursive } = options;
        const subscribers = new Set<ISubscriber>();
        const subscription = this.delegate.watchTree(base, options, (changes) => {
            // Снимок: подписчик вправе отписаться (и унести соседа, и подписаться
            // заново) прямо из своего колбэка.
            for (const subscriber of [...subscribers]) {
                if (subscriber.disposed) continue;
                const batch = filterForSubscriber(base, recursive, subscriber, changes);
                if (batch.length > 0) subscriber.onChanges(batch);
            }
        });
        const traversal: ITraversal = {
            root: base,
            recursive,
            excludes: options.excludes,
            excludesKey: toExcludesKey(options.excludes),
            subscribers,
            subscription,
        };
        this.traversals.add(traversal);
        return traversal;
    }
}

/**
 * Покрывает ли живой обход запрос `(base, recursive)` **без потери событий**.
 *
 * Совпадающий корень — чистая дедупликация: рекурсивный обход отдаёт и
 * рекурсивному, и нерекурсивному запросу, нерекурсивный — только
 * нерекурсивному. Вложенная база требует большего, см. {@link reanchorsCleanly}.
 *
 * Excludes сравнивает вызывающий: без равенства наборов разговора нет.
 */
function covers(traversal: ITraversal, base: string, recursive: boolean): boolean {
    if (traversal.root === base) return traversal.recursive || !recursive;
    if (!traversal.recursive) return false;
    const relative = relativeUnder(traversal.root, base);
    return relative !== null && reanchorsCleanly(traversal, relative);
}

/**
 * Даст ли вложенной базе обход ровно те же события, что дал бы свой watcher
 * на этой базе.
 *
 * Тонкость, из-за которой нельзя просто сравнить списки excludes: шаблоны
 * матчатся против пути **относительно корня обхода**, поэтому один и тот же
 * `**\/.git/objects/**` на корне воркспейса и на `.git` исключает разное. Делим
 * поток только когда переякоривание заведомо ничего не меняет:
 *
 * - каждый шаблон — `**\/<один сегмент>`: такой матчит последний сегмент пути и
 *   не зависит от того, сколько сегментов перед ним (см. `**\/` → `(?:.*\/)?`
 *   в `globToRegExp`);
 * - ни сама база, ни каталог по пути к ней не исключены у обхода — иначе
 *   chokidar до базы просто не дойдёт, а свой watcher за ней следил бы
 *   (корень никогда не исключается сам у себя).
 *
 * Не выполнилось — заводим свой обход: лишний обход дешевле молча не
 * доставленных событий.
 */
function reanchorsCleanly(traversal: ITraversal, relativeBase: string): boolean {
    if (!traversal.excludes.every(isAnchorAgnostic)) return false;
    // Шагаем от корня обхода к базе ровно по тем каталогам, в которые chokidar
    // должен был зайти.
    let current = traversal.root;
    for (const segment of relativeBase.split(path.sep)) {
        current = path.join(current, segment);
        if (isExcluded(traversal.root, current, traversal.excludes)) return false;
    }
    return true;
}

/** Шаблон вида `**\/<сегмент>` — тот, чей смысл не зависит от корня матчинга. */
function isAnchorAgnostic(pattern: string): boolean {
    return pattern.startsWith("**/") && !pattern.slice(3).includes("/");
}

/**
 * Урезает пачку обхода до того, что видел бы собственный watcher подписчика:
 * только пути под его базой, а нерекурсивному — только прямые дети.
 *
 * Единственный подписчик своего же обхода получает пачку как есть: типовой
 * случай не должен платить за копию.
 */
function filterForSubscriber(
    root: string,
    recursive: boolean,
    subscriber: ISubscriber,
    changes: readonly ITreeFileChange[],
): readonly ITreeFileChange[] {
    if (root === subscriber.base && recursive === subscriber.recursive) return changes;
    return changes.filter((change) => {
        const relative = relativeUnder(subscriber.base, change.path);
        if (relative === null || relative === "") return false; // вне базы либо сама база
        return subscriber.recursive || !relative.includes(path.sep);
    });
}

/**
 * Путь `child` относительно `parent`, либо `null`, если он вне поддерева
 * (равный путь даёт `""` — строгость определяет вызывающий).
 *
 * Оба пути уже нормализованы (`path.resolve` на базе, chokidar склеивает
 * события от корня обхода), поэтому хватает префикса по границе сегмента —
 * и это заметно дешевле `path.relative` на каждое файловое событие. Разделитель
 * в префиксе обязателен: `/repo/srcx` не лежит в `/repo/src`.
 */
function relativeUnder(parent: string, child: string): string | null {
    if (child === parent) return "";
    // Корень (`/`, на Windows `C:\`) — единственный путь, который сам кончается
    // разделителем; второй подряд превратил бы префикс в несуществующий.
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

/** Ключ сравнения наборов excludes: порядок шаблонов ничего не значит. */
function toExcludesKey(excludes: readonly string[]): string {
    return JSON.stringify([...excludes].sort());
}
