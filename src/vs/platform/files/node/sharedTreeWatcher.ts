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
 * A request whose subtree is already covered by a live traversal rides its event stream
 * instead of its own `chokidar.watch` (like VS Code's watcher process): built-in git
 * asks for three traversals, each LSP client for its own, and without deduplication the
 * second or third wave of subscriptions hits the inotify limit. From outside the behavior
 * is indistinguishable from independent watchers.
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
        // Ancestor/descendant checks below work on strings.
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
            // Snapshot: a subscriber may unsubscribe (itself or a neighbor) from its callback.
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

/** The caller compares excludes. */
function covers(traversal: ITraversal, base: string, recursive: boolean): boolean {
    if (traversal.root === base) return traversal.recursive || !recursive;
    if (!traversal.recursive) return false;
    const relative = relativeUnder(traversal.root, base);
    return relative !== null && reanchorsCleanly(traversal, relative);
}

/**
 * Whether the traversal gives a nested base the same events as its own watcher would.
 * Excludes match **relative to the traversal root** (`**\/.git/objects/**` on the root
 * and on `.git` excludes different things), so the stream is shared only when re-anchoring
 * is known to change nothing:
 * - every pattern is `**\/<single segment>`: it doesn't depend on the number of segments before it;
 * - neither the base nor any directory on the way to it is excluded, otherwise chokidar never reaches the base;
 * - neither the base nor any directory on the way to it is a symlink: the traversal doesn't follow
 *   links, while a dedicated request resolves to the target. Upstream (`removeDuplicateRequests`)
 *   doesn't check for a link above the base; we do, otherwise there would be no events at all.
 *
 * An extra traversal is cheaper than silently undelivered events.
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
 * `null` if `child` is not **strictly inside** `parent`. Both paths are already normalized,
 * so a prefix check on a segment boundary suffices, which is cheaper than `path.relative`
 * per event.
 */
function relativeUnder(parent: string, child: string): string | null {
    // A root (`/`, `C:\`) already ends with a separator; a second one would break the prefix.
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

function toExcludesKey(excludes: readonly string[]): string {
    return JSON.stringify([...excludes].sort());
}
