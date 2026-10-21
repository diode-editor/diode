import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import type { IOriginalResourceProvider } from "./quickDiffService.ts";

/** Аналог `provideOriginalResource`. */
export const ORIGINAL_RESOURCE_COMMAND = "diode.scm.originalResource";

/**
 * Транспорт временный: канонический `scm`-неймспейс с `quickDiffProvider` в `vscode.d.ts`
 * ещё закомментирован (docs/TODO/Diff.md). Переход заменит этот класс, а не `QuickDiffService`.
 */
export class CommandOriginalResourceProvider implements IOriginalResourceProvider {
    public constructor(private readonly commands: CommandRegistry) {}

    public async provideOriginalResource(uri: Uri, ref?: string): Promise<Uri | null> {
        // Нет SCM-расширения — нет и оригинала; это штатная ситуация, а не сбой.
        if (!this.commands.has(ORIGINAL_RESOURCE_COMMAND)) return null;

        const raw: unknown =
            ref === undefined
                ? await this.commands.execute(ORIGINAL_RESOURCE_COMMAND, uri.toString())
                : await this.commands.execute(ORIGINAL_RESOURCE_COMMAND, uri.toString(), ref);
        if (typeof raw !== "string" || raw === "") return null;
        return Uri.parse(raw);
    }
}
