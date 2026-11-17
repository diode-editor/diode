/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/replFilter.ts
// The filter of the Debug Console: comma-separated queries, `!` excludes, `\` escapes a leading `!`. Deviations: a
// boolean per element instead of the tree's `TreeVisibility`, and no parent's verdict: an element without one is
// visible, as the parent of a shown child is (a hidden group is not expanded); `matchesFuzzy` is its first step — a case-insensitive match with `*` as a wildcard — whose
// contiguous fallback finds nothing more.

import { splitGlobAware } from "../../../../base/common/glob.ts";
import type { IReplElement } from "../common/debug.ts";
import { Variable } from "../common/debugModel.ts";
import { ReplEvaluationInput, ReplEvaluationResult } from "../common/replModel.ts";

interface IParsedQuery {
    readonly type: "include" | "exclude";
    readonly query: string;
}

/** Upstream `matchesFuzzy` as far as it goes for the filter: `convertSimple2RegExpPattern`, case-insensitive. */
function matchQuery(query: string, text: string): boolean {
    const pattern = query.replace(/[\\^$.+?()[\]{}|/]/gu, "\\$&").replace(/\*/gu, ".*");
    return new RegExp(pattern, "iu").test(text);
}

export class ReplFilter {
    // Stryker disable next-line ArrayDeclaration: an entry that is not a query has no type and matches nothing
    private parsedQueries: readonly IParsedQuery[] = [];

    /** Upstream's parse without its trim and empty checks: blank parts are dropped one by one. */
    public set filterQuery(query: string) {
        this.parsedQueries = splitGlobAware(query, ",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((f): IParsedQuery => {
                if (f.startsWith("\\")) return { type: "include", query: f.slice(1) };
                if (f.startsWith("!")) return { type: "exclude", query: f.slice(1) };
                return { type: "include", query: f };
            });
    }

    public filter(element: IReplElement): boolean {
        if (
            element instanceof ReplEvaluationInput ||
            element instanceof ReplEvaluationResult ||
            element instanceof Variable
        ) {
            // Only filter the output events, everything else is visible https://github.com/microsoft/vscode/issues/105863
            return true;
        }

        let includeQueryPresent = false;
        let includeQueryMatched = false;

        const text = element.toString(true);

        for (const { type, query } of this.parsedQueries) {
            if (type === "exclude" && matchQuery(query, text)) {
                // If exclude query matches, ignore all other queries and hide
                return false;
            } else if (type === "include") {
                includeQueryPresent = true;
                if (matchQuery(query, text)) {
                    includeQueryMatched = true;
                }
            }
        }

        return !includeQueryPresent || includeQueryMatched;
    }
}
