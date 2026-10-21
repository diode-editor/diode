import * as path from "node:path";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import { isExcluded } from "./chokidarTreeWatcher.ts";
import { passesThroughSymlink } from "./passesThroughSymlink.ts";

interface ITraversal {
    readonly root: string;
    readonly recursive: boolean;
    readonly excludes: readonly string[];
    readonly excludesKey: string;
    readonly subscribers: Set<ISubscriber>;
    readonly subscription: IDisposable;
}

interface ISubscriber {
    readonly base: string;
    readonly recursive: boolean;
    readonly onChanges: (changes: readonly ITreeFileChange[]) => void;
    disposed: boolean;
}

/**
 * Запрос, чьё поддерево уже покрыто живым обходом, едет на его потоке событий
 * вместо своего `chokidar.watch` (как watcher-процесс VS Code): встроенный git
 * просит три обхода, каждый LSP-клиент — свои, и без дедупликации вторая-третья
 * волна подписок упирается в лимит inotify. Снаружи поведение неотличимо от
 * независимых watcher'ов.
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
        // «Предок/потомок» дальше считается по строкам.
        const base = path.resolve(rootPath);
        const subscriber: ISubscriber = { base, recursive: options.recursive, onChanges, disposed: false };
        const traversal = this.findReusable(base, options) ?? this.createTraversal(base, options);
        traversal.subscribers.add(subscriber);
        return {
            dispose: () => {
                if (subscriber.disposed) return;
                subscriber.disposed = true;
                traversal.subscribers.delete(subscriber);
                if (traversal.subscribers.size > 0) return;
                this.traversals.delete(traversal);
                traversal.subscription.dispose();
            },
        };
    }

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
            // Снимок: подписчик вправе отписаться (и унести соседа) из своего колбэка.
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

/** Excludes сравнивает вызывающий. */
function covers(traversal: ITraversal, base: string, recursive: boolean): boolean {
    if (traversal.root === base) return traversal.recursive || !recursive;
    if (!traversal.recursive) return false;
    const relative = relativeUnder(traversal.root, base);
    return relative !== null && reanchorsCleanly(traversal, relative);
}

/**
 * Даст ли вложенной базе обход те же события, что свой watcher на ней. Excludes
 * матчатся **относительно корня обхода** (`**\/.git/objects/**` на корне и на
 * `.git` исключает разное), поэтому делим поток, только когда переякоривание
 * заведомо ничего не меняет:
 * - каждый шаблон — `**\/<один сегмент>`: он не зависит от числа сегментов перед ним;
 * - ни база, ни каталог по пути к ней не исключены — иначе chokidar до базы не дойдёт;
 * - ни база, ни каталог по пути к ней не симлинк: обход по ссылкам не ходит, а
 *   свой запрос разрешается до цели. Эталон (`removeDuplicateRequests`) ссылку
 *   выше базы не проверяет — мы проверяем, иначе событий не было бы вовсе.
 *
 * Лишний обход дешевле молча не доставленных событий.
 */
function reanchorsCleanly(traversal: ITraversal, relativeBase: string): boolean {
    if (!traversal.excludes.every(isAnchorAgnostic)) return false;
    let current = traversal.root;
    for (const segment of relativeBase.split(path.sep)) {
        current = path.join(current, segment);
        if (isExcluded(traversal.root, current, traversal.excludes)) return false;
    }
    return !passesThroughSymlink(traversal.root, relativeBase);
}

function isAnchorAgnostic(pattern: string): boolean {
    return pattern.startsWith("**/") && !pattern.slice(3).includes("/");
}

function filterForSubscriber(
    root: string,
    recursive: boolean,
    subscriber: ISubscriber,
    changes: readonly ITreeFileChange[],
): readonly ITreeFileChange[] {
    if (root === subscriber.base && recursive === subscriber.recursive) return changes;
    return changes.filter((change) => {
        const relative = relativeUnder(subscriber.base, change.path);
        if (relative === null) return false;
        return subscriber.recursive || !relative.includes(path.sep);
    });
}

/**
 * `null`, если `child` не **строго внутри** `parent`. Оба пути уже нормализованы,
 * поэтому хватает префикса по границе сегмента — дешевле `path.relative` на
 * каждое событие.
 */
function relativeUnder(parent: string, child: string): string | null {
    // Корень (`/`, `C:\`) сам кончается разделителем — второй сломал бы префикс.
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

function toExcludesKey(excludes: readonly string[]): string {
    return JSON.stringify([...excludes].sort());
}
