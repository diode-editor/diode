/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/breakpoints.ts

import { deserializeWhen } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import type { IBreakpointContribution } from "./debug.ts";

/** A `contributes.breakpoints` entry: the language where breakpoints can be set, while its `when` holds. */
export class Breakpoints {
    /** Like upstream `ContextKeyExpr.deserialize`, a `when` that does not parse is no condition at all. */
    private readonly breakpointsWhen: string | undefined;

    public constructor(
        private readonly breakpointContribution: IBreakpointContribution,
        private readonly contextKeyService: Pick<ContextKeyService, "evaluate">,
    ) {
        const when = breakpointContribution.when;
        this.breakpointsWhen = typeof when === "string" && deserializeWhen(when) !== undefined ? when : undefined;
    }

    public get language(): string {
        return this.breakpointContribution.language;
    }

    public get enabled(): boolean {
        return !this.breakpointsWhen || this.contextKeyService.evaluate(this.breakpointsWhen);
    }
}
