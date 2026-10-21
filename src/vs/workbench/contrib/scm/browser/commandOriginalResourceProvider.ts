import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import type { IOriginalResourceProvider } from "./quickDiffService.ts";

/** Counterpart of `provideOriginalResource`. */
export const ORIGINAL_RESOURCE_COMMAND = "diode.scm.originalResource";

/**
 * Temporary transport: the canonical `scm` namespace with `quickDiffProvider` in `vscode.d.ts`
 * is still commented out (docs/TODO/Diff.md). Moving to it will replace this class, not `QuickDiffService`.
 */
export class CommandOriginalResourceProvider implements IOriginalResourceProvider {
    public constructor(private readonly commands: CommandRegistry) {}

    public async provideOriginalResource(uri: Uri, ref?: string): Promise<Uri | null> {
        // No SCM extension means no original; this is normal, not a failure.
        if (!this.commands.has(ORIGINAL_RESOURCE_COMMAND)) return null;

        const raw: unknown =
            ref === undefined
                ? await this.commands.execute(ORIGINAL_RESOURCE_COMMAND, uri.toString())
                : await this.commands.execute(ORIGINAL_RESOURCE_COMMAND, uri.toString(), ref);
        if (typeof raw !== "string" || raw === "") return null;
        return Uri.parse(raw);
    }
}
