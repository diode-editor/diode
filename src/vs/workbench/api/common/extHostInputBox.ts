import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { ExtHostQuickInput } from "./extHostQuickInput.ts";
import { InputBoxValidationSeverity } from "./vscodeTypes.ts";
import type { IWireValidationMessage, WireValidationSeverity } from "./wireTypes.ts";

export function toWireValidation(
    outcome: string | vscode.InputBoxValidationMessage | undefined | null,
): IWireValidationMessage | null {
    if (outcome === undefined || outcome === null) return null;
    if (typeof outcome === "string") {
        // A bare string is always an error (as documented in vscode.d.ts).
        return outcome === "" ? null : { message: outcome, severity: "error" };
    }
    if (typeof outcome.message !== "string" || outcome.message === "") return null;
    return { message: outcome.message, severity: toWireSeverity(outcome.severity) };
}

/**
 * Compare NUMBERS: the extension has its own `InputBoxValidationSeverity` from its copy
 * of `vscode.d.ts`; there is no enum type shared with ours.
 */
function toWireSeverity(severity: number | undefined): WireValidationSeverity {
    if (severity === InputBoxValidationSeverity.Warning) return "warning";
    if (severity === InputBoxValidationSeverity.Info) return "info";
    return "error";
}

/** Upstream `ExtHostInputBox`: the live `window.createInputBox`, on the same channel as the quick pick. */
export class ExtHostInputBox extends ExtHostQuickInput implements vscode.InputBox {
    private passwordValue = false;
    private valueSelectionValue: readonly [number, number] | undefined;
    private validationMessageValue: string | vscode.InputBoxValidationMessage | undefined;

    public constructor(rpc: SubprocessRpc, handle: number, onDispose: () => void) {
        super(rpc, handle, onDispose, { inputBox: true });
    }

    public get password(): boolean {
        return this.passwordValue;
    }
    public set password(password: boolean) {
        this.passwordValue = password;
        this.update({ password });
    }

    public get valueSelection(): readonly [number, number] | undefined {
        return this.valueSelectionValue;
    }
    public set valueSelection(valueSelection: readonly [number, number] | undefined) {
        this.valueSelectionValue = valueSelection;
        this.update({ valueSelection });
    }

    public get validationMessage(): string | vscode.InputBoxValidationMessage | undefined {
        return this.validationMessageValue;
    }
    public set validationMessage(validationMessage: string | vscode.InputBoxValidationMessage | undefined) {
        this.validationMessageValue = validationMessage;
        this.update({ validationMessage: toWireValidation(validationMessage) });
    }
}
