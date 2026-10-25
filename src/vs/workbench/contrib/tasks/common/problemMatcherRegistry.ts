// Upstream's `ProblemPatternRegistry` and `ProblemMatcherRegistry` in one: the built-in patterns and matchers
// plus `contributes.problemPatterns`/`contributes.problemMatchers` of the window's extensions. The extension
// set is static for the window's lifetime, so there is no removal delta: a removed or disabled extension is
// gone after the window reload (docs/arch/workbench/Tasks.md).

import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

import {
    BUILTIN_PROBLEM_MATCHERS,
    type IProblemMatcher,
    type IProblemMatcherLookup,
    type IProblemPattern,
    parseProblemMatcher,
    parseProblemPattern,
} from "./problemMatcher.ts";

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A manifest is foreign data: a contribution that is not an array contributes nothing. */
function contributionsOf(extension: IContributingExtension, point: string): readonly unknown[] {
    const value = extension.manifest.contributes?.[point];
    // Stryker disable next-line ArrayDeclaration: equivalent: a made-up item is not an object and is skipped
    return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** Upstream's `Config.NamedMultiLineCheckedProblemPattern.is`. */
function isNamedMultiLinePattern(value: Json): boolean {
    return (
        Array.isArray(value.patterns) &&
        value.patterns.every((pattern) => isObject(pattern) && typeof pattern.regexp === "string")
    );
}

export type IContributingExtension = Pick<IExtension, "id" | "manifest">;

/** Upstream's `ExtensionRegistryReporter`: a message about the extension's contribution. */
export type ExtensionProblemReporter = (extension: IContributingExtension, message: string) => void;

export class ProblemMatcherRegistry implements IProblemMatcherLookup {
    private readonly patterns = new Map<string, IProblemPattern | readonly IProblemPattern[]>();
    private readonly matchers = new Map<string, IProblemMatcher>();
    private readonly ready = Promise.withResolvers<undefined>();

    /** Resolves once the extensions' contributions are registered (upstream's `onReady`). */
    public onReady(): Promise<undefined> {
        return this.ready.promise;
    }

    public getPattern(name: string): IProblemPattern | readonly IProblemPattern[] | undefined {
        return this.patterns.get(name) ?? BUILTIN_PROBLEM_MATCHERS.getPattern(name);
    }

    public getMatcher(name: string): IProblemMatcher | undefined {
        return this.matchers.get(name) ?? BUILTIN_PROBLEM_MATCHERS.getMatcher(name);
    }

    /** By name with or without `$`, as tasks refer to matchers. */
    public resolve(name: string): IProblemMatcher | undefined {
        return this.getMatcher(name.startsWith("$") ? name.substring(1) : name);
    }

    /**
     * Patterns of all extensions before matchers (upstream's `deps`), so a matcher may refer to a pattern of
     * another extension. A name taken by a built-in or an earlier extension is overwritten (upstream's `add`).
     */
    public registerExtensions(extensions: readonly IContributingExtension[], report: ExtensionProblemReporter): void {
        for (const extension of extensions) {
            for (const value of contributionsOf(extension, "problemPatterns")) {
                this.addPattern(value, (message) => {
                    report(extension, message);
                });
            }
        }
        for (const extension of extensions) {
            for (const value of contributionsOf(extension, "problemMatchers")) {
                this.addMatcher(value, (message) => {
                    report(extension, message);
                });
            }
        }
        this.ready.resolve(undefined);
    }

    /** Any message of the parser makes the pattern invalid: all of them are errors upstream. */
    private addPattern(value: unknown, report: (message: string) => void): void {
        // Upstream registers only `Config.NamedProblemPattern`/`NamedMultiLineCheckedProblemPattern` values.
        if (!isObject(value) || typeof value.name !== "string") return;
        const messages: string[] = [];
        const pattern = parseProblemPattern(isNamedMultiLinePattern(value) ? value.patterns : value, (message) =>
            messages.push(message),
        );
        for (const message of messages) report(message);
        // Stryker disable next-line ConditionalExpression: equivalent: the parser gives no pattern only after a message
        if (pattern !== undefined && messages.length === 0) {
            this.patterns.set(value.name, pattern);
            return;
        }
        report("Invalid problem pattern. The pattern will be ignored.");
        report(JSON.stringify(value, undefined, 4));
    }

    private addMatcher(value: unknown, report: (message: string) => void): void {
        if (!isObject(value)) return;
        const matcher = parseProblemMatcher(value, report, this);
        // Upstream keeps only a named one (`isNamedProblemMatcher`).
        // Stryker disable next-line ConditionalExpression: equivalent: a matcher under the key `undefined` is never looked up
        if (matcher !== undefined && typeof value.name === "string") this.matchers.set(value.name, matcher);
    }
}

/** Ready once the extension host module registers the extensions' contributions (`bindExtensionTasks`). */
export const ProblemMatcherRegistryDIToken = token<ProblemMatcherRegistry>("ProblemMatcherRegistry");
