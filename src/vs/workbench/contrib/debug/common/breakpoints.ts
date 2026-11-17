/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/breakpoints.ts

import { deserializeWhen, whenKeys } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import type { IBreakpointContribution } from "./debug.ts";

/** A `contributes.breakpoints` entry: the language where breakpoints can be set, while its `when` holds. */
export class Breakpoints {
    /** Like upstream `ContextKeyExpr.deserialize`, a `when` that does not parse is no condition at all. */
    private readonly breakpointsWhen: string | undefined;
    /** Ours: the context keys of the `when`, whose changes may enable or disable the contribution. */
    public readonly whenKeys: readonly string[];

    public constructor(
        private readonly breakpointContribution: IBreakpointContribution,
        private readonly contextKeyService: Pick<ContextKeyService, "evaluate">,
    ) {
        const when = breakpointContribution.when;
        // Stryker disable next-line ConditionalExpression: `deserializeWhen(undefined)` is undefined too, the scanner throws and the parser catches
        const expression = typeof when === "string" ? deserializeWhen(when) : undefined;
        this.breakpointsWhen = expression === undefined ? undefined : when;
        this.whenKeys = expression === undefined ? [] : whenKeys(expression);
    }

    public get language(): string {
        return this.breakpointContribution.language;
    }

    public get enabled(): boolean {
        return !this.breakpointsWhen || this.contextKeyService.evaluate(this.breakpointsWhen);
    }
}
