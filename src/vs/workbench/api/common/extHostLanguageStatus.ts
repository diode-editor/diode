import type * as vscode from "vscode";

import { toWireLanguageFilters } from "./documentSelector.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { LanguageStatusSeverity } from "./vscodeTypes.ts";
import type { IWireLanguageStatusItem, WireLanguageStatusSeverity } from "./wireTypes.ts";

type LanguageStatusFields = Omit<vscode.LanguageStatusItem, "id" | "dispose">;

/**
 * Upstream `ExtHostLanguages.createLanguageStatusItem`: the item is on the wire from creation, every field
 * change resends its full state. Deviation: the update goes out at once rather than on the next tick.
 */
export function createLanguageStatusItemFactory(
    ctx: Pick<IVscodeHostContext, "rpc" | "owner">,
): (id: string, selector: vscode.DocumentSelector) => vscode.LanguageStatusItem {
    let nextHandle = 0;
    const ids = new Set<string>();
    return (id, selector) => {
        // The owner is set only for the duration of the call into the extension: capture it now.
        const source = ctx.owner.current ?? "";
        const fullyQualifiedId = `${source}/${id}`;
        if (ids.has(fullyQualifiedId)) throw new Error(`LanguageStatusItem with id '${id}' ALREADY exists`);
        ids.add(fullyQualifiedId);
        const handle = nextHandle++;
        const data: LanguageStatusFields = {
            selector,
            name: undefined,
            text: "",
            detail: undefined,
            severity: LanguageStatusSeverity.Information,
            busy: false,
            command: undefined,
        };
        let disposed = false;

        const push = (): void => {
            if (disposed) return;
            ctx.rpc.notify("languages.statusItem.update", toWire(handle, fullyQualifiedId, source, data));
        };
        // The setter is typed by the vscode.d.ts surface: a value here is already the field's type.
        const fields = data as unknown as Record<keyof LanguageStatusFields, unknown>;
        const field = (key: keyof LanguageStatusFields): PropertyDescriptor => ({
            enumerable: true,
            get: () => fields[key],
            set: (value: unknown) => {
                fields[key] = value;
                push();
            },
        });

        const item = {
            id,
            dispose: (): void => {
                if (disposed) return;
                disposed = true;
                ids.delete(fullyQualifiedId);
                ctx.rpc.notify("languages.statusItem.dispose", { handle });
            },
        } as vscode.LanguageStatusItem;
        for (const key of Object.keys(data) as (keyof LanguageStatusFields)[]) {
            Object.defineProperty(item, key, field(key));
        }
        push();
        return item;
    };
}

function toWire(handle: number, id: string, source: string, data: LanguageStatusFields): IWireLanguageStatusItem {
    const { command } = data;
    return {
        handle,
        id,
        source,
        selector: toWireLanguageFilters(data.selector),
        text: data.text,
        severity: toWireSeverity(data.severity),
        busy: data.busy,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.detail === undefined ? {} : { detail: data.detail }),
        ...(command === undefined
            ? {}
            : {
                  command: {
                      command: command.command,
                      title: command.title,
                      ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}),
                  },
              }),
    };
}

/** Nominally different enums with the same values: compare as numbers, an unknown value is Information. */
function toWireSeverity(severity: vscode.LanguageStatusSeverity): WireLanguageStatusSeverity {
    const value = severity as number;
    return value === 1 || value === 2 ? value : 0;
}
