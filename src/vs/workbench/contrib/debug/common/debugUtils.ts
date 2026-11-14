/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugUtils.ts
// Not here yet, each with the task that needs it: `getEvaluatableExpressionAtPosition` (hover, it needs the language
// features), `saveAllBeforeDebugStart` (starting a session), `convertToDAPaths`/`convertToVSCPaths` (the bridge to
// the extension host). Not planned: `filterExceptionsFromTelemetry` (no telemetry).

import { currentOperatingSystem, OperatingSystem } from "../../../../base/common/platform.ts";

import type { IConfig, IConfigPresentation, IDebuggerContribution, IDebugSession } from "./debug.ts";
import { State } from "./debug.ts";

const _formatPIIRegexp = /{([^}]+)}/g;

export function formatPII(value: string, excludePII: boolean, args: Record<string, string> | undefined): string {
    return value.replace(_formatPIIRegexp, function (match, group: string) {
        if (excludePII && group.length > 0 && !group.startsWith("_")) {
            return match;
        }

        return args && Object.hasOwn(args, group) ? args[group] : match;
    });
}

export function isSessionAttach(session: IDebugSession): boolean {
    return (
        session.configuration.request === "attach" &&
        !getExtensionHostDebugSession(session) &&
        (!session.parentSession || isSessionAttach(session.parentSession))
    );
}

/**
 * Returns the session or any parent which is an extension host debug session.
 * Returns undefined if there's none.
 */
export function getExtensionHostDebugSession(session: IDebugSession): IDebugSession | undefined {
    let type = session.configuration.type;
    if (!type) {
        return;
    }

    if (type === "vslsShare") {
        type =
            (session.configuration as { adapterProxy?: { configuration?: { type?: string } } }).adapterProxy
                ?.configuration?.type ?? type;
    }

    const lowerType = type.toLowerCase();
    if (lowerType === "extensionhost" || lowerType === "pwa-extensionhost") {
        return session;
    }

    return session.parentSession ? getExtensionHostDebugSession(session.parentSession) : undefined;
}

// only a debugger contributions with a label, program, or runtime attribute is considered a "defining" or "main" debugger contribution
export function isDebuggerMainContribution(dbg: IDebuggerContribution): boolean {
    return Boolean(dbg.type) && (Boolean(dbg.label) || Boolean(dbg.program) || Boolean(dbg.runtime));
}

/**
 * Note- uses 1-indexed numbers
 */
export function getExactExpressionStartAndEnd(
    lineContent: string,
    looseStart: number,
    looseEnd: number,
): { start: number; end: number } {
    let matchingExpression: string | undefined = undefined;
    let startOffset = 0;

    // Some example supported expressions: myVar.prop, a.b.c.d, myVar?.prop, myVar->prop, MyClass::StaticProp, *myVar, ...foo
    // Match any character except a set of characters which often break interesting sub-expressions
    const expression = /([^()[\]{}<>\s+\-/%~#^;=|,`!]|->)+/g;
    let result: RegExpExecArray | null;

    // First find the full expression under the cursor
    while ((result = expression.exec(lineContent))) {
        const start = result.index + 1;
        const end = start + result[0].length;

        if (start <= looseStart && end >= looseEnd) {
            matchingExpression = result[0];
            startOffset = start;
            break;
        }
    }

    // Handle spread syntax: if the expression starts with '...', extract just the identifier
    if (matchingExpression) {
        const spreadMatch = /^\.\.\.(.+)/.exec(matchingExpression);
        if (spreadMatch) {
            matchingExpression = spreadMatch[1];
            startOffset += 3; // Skip the '...' prefix
        }
    }

    // If there are non-word characters after the cursor, we want to truncate the expression then.
    // For example in expression 'a.b.c.d', if the focus was under 'b', 'a.b' would be evaluated.
    if (matchingExpression) {
        const subExpression = /(\w|\p{L})+/gu;
        let subExpressionResult: RegExpExecArray | null;
        while ((subExpressionResult = subExpression.exec(matchingExpression))) {
            const subEnd = subExpressionResult.index + 1 + startOffset + subExpressionResult[0].length;
            if (subEnd >= looseEnd) {
                break;
            }
        }

        if (subExpressionResult) {
            matchingExpression = matchingExpression.substring(0, subExpression.lastIndex);
        }
    }

    return matchingExpression
        ? { start: startOffset, end: startOffset + matchingExpression.length - 1 }
        : { start: 0, end: 0 };
}

// RFC 2396, Appendix A: https://www.ietf.org/rfc/rfc2396.txt
const _schemePattern = /^[a-zA-Z][a-zA-Z0-9+\-.]+:/;

export function isUriString(s: string | undefined): boolean {
    // heuristics: a valid uri starts with a scheme and
    // the scheme has at least 2 characters so that it doesn't look like a drive letter.
    return !!s && _schemePattern.test(s);
}

export function getVisibleAndSorted<T extends { presentation?: IConfigPresentation }>(array: T[]): T[] {
    return array
        .filter((config) => !config.presentation?.hidden)
        .sort((first, second) => {
            if (!first.presentation) {
                if (!second.presentation) {
                    return 0;
                }
                return 1;
            }
            if (!second.presentation) {
                return -1;
            }
            if (!first.presentation.group) {
                if (!second.presentation.group) {
                    return compareOrders(first.presentation.order, second.presentation.order);
                }
                return 1;
            }
            if (!second.presentation.group) {
                return -1;
            }
            if (first.presentation.group !== second.presentation.group) {
                return first.presentation.group.localeCompare(second.presentation.group);
            }

            return compareOrders(first.presentation.order, second.presentation.order);
        });
}

function compareOrders(first: number | undefined, second: number | undefined): number {
    if (typeof first !== "number") {
        if (typeof second !== "number") {
            return 0;
        }

        return 1;
    }
    if (typeof second !== "number") {
        return -1;
    }

    return first - second;
}

export const sourcesEqual = (a: DebugProtocol.Source | undefined, b: DebugProtocol.Source | undefined): boolean =>
    !a || !b ? a === b : a.name === b.name && a.path === b.path && a.sourceReference === b.sourceReference;

/**
 * Resolves the best child session to focus when a parent session is selected.
 * Always prefer child sessions over parent wrapper sessions to ensure console responsiveness.
 * Fixes issue #152407: Using debug console picker when not paused leaves console unresponsive.
 */
export function resolveChildSession(session: IDebugSession, allSessions: readonly IDebugSession[]): IDebugSession {
    // Always focus child session instead of parent wrapper session #152407
    const childSessions = allSessions.filter((s) => s.parentSession === session);
    if (childSessions.length > 0) {
        // Prefer stopped child session if available #112595
        const stoppedChildSession = childSessions.find((s) => s.state === State.Stopped);
        if (stoppedChildSession) {
            return stoppedChildSession;
        } else {
            // If no stopped child, focus the first available child session
            return childSessions[0];
        }
    }
    // Return the original session if it has no children
    return session;
}

type IPlatformSpecificConfig = NonNullable<IConfig["windows"]>;

function getPlatformSpecificConfig(config: IConfig, os: OperatingSystem): IPlatformSpecificConfig | undefined {
    switch (os) {
        case OperatingSystem.Windows:
            return config.windows;
        case OperatingSystem.Macintosh:
            return config.osx;
        case OperatingSystem.Linux:
            return config.linux;
    }
}

export function getEffectiveConfigForPlatform(
    config: IConfig,
    os: OperatingSystem = currentOperatingSystem(),
): IConfig {
    const platformConfig = getPlatformSpecificConfig(config, os);
    if (!platformConfig) {
        return config;
    }

    return {
        ...config,
        ...platformConfig,
        presentation: platformConfig.presentation
            ? { ...config.presentation, ...platformConfig.presentation }
            : config.presentation,
    };
}

export function getEffectivePresentationForConfig(
    config: IConfig,
    os: OperatingSystem = currentOperatingSystem(),
): IConfigPresentation | undefined {
    return getEffectiveConfigForPlatform(config, os).presentation;
}
