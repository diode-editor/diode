// Upstream `cwdDetectionCapability.ts` without the cwd history (`cwds`: Go to Recent Directory, not in this wave).

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

export class CwdDetectionCapability implements IDisposable {
    private cwd = "";
    private trusted = true;
    private readonly onDidChangeCwdEmitter = new Emitter<string>();

    /** Fires when the cwd or its trust changes. */
    public readonly onDidChangeCwd = this.onDidChangeCwdEmitter.event;

    public getCwd(): string {
        return this.cwd;
    }

    /** The last report came with the terminal's nonce (`633;P;Cwd=<cwd>;<nonce>`); OSC 7 and 1337 never do. */
    public get isTrusted(): boolean {
        return this.trusted;
    }

    public updateCwd(cwd: string, isTrusted: boolean): void {
        if (this.cwd === cwd && this.trusted === isTrusted) return;
        this.cwd = cwd;
        this.trusted = isTrusted;
        this.onDidChangeCwdEmitter.fire(cwd);
    }

    public dispose(): void {
        this.onDidChangeCwdEmitter.dispose();
    }
}
