/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugCompoundRoot.ts
// The sessions of a compound with `stopAll`: one stopped by the user stops the others.

import { Emitter } from "../../../../base/common/event.ts";

export class DebugCompoundRoot {
    private stopped = false;
    private readonly stopEmitter = new Emitter<void>();

    public readonly onDidSessionStop = this.stopEmitter.event;

    public sessionStopped(): void {
        if (!this.stopped) {
            // avoid sending extranous terminate events
            this.stopped = true;
            this.stopEmitter.fire();
        }
    }
}
