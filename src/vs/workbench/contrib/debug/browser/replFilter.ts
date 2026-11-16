/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/replFilter.ts
// The filter of the Debug Console: comma-separated queries, `!` excludes, `\` escapes a leading `!`. Deviations: a
// boolean per element instead of the tree's `TreeVisibility` (an element without a verdict takes its parent's, which
// the console passes in); `matchesFuzzy` is its first step — a case-insensitive match with `*` as a wildcard — whose
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
    private parsedQueries: IParsedQuery[] = [];

    public set filterQuery(query: string) {
        this.parsedQueries = [];
        query = query.trim();

        if (query !== "") {
            const filters = splitGlobAware(query, ",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            for (const f of filters) {
                if (f.startsWith("\\")) {
                    this.parsedQueries.push({ type: "include", query: f.slice(1) });
                } else if (f.startsWith("!")) {
                    this.parsedQueries.push({ type: "exclude", query: f.slice(1) });
                } else {
                    this.parsedQueries.push({ type: "include", query: f });
                }
            }
        }
    }

    public filter(element: IReplElement, parentVisible = true): boolean {
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

        return includeQueryPresent ? includeQueryMatched : parentVisible;
    }
}
