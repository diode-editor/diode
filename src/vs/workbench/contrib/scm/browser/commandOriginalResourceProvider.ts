import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import type { IOriginalResourceProvider } from "./quickDiffService.ts";

/** Команда, которой SCM-расширение отдаёт ресурс оригинала (аналог `provideOriginalResource`). */
export const ORIGINAL_RESOURCE_COMMAND = "vexx.scm.originalResource";

/**
 * {@link IOriginalResourceProvider} поверх реестра команд: ресурс оригинала
 * спрашивается у расширения командой {@link ORIGINAL_RESOURCE_COMMAND}.
 *
 * Транспорт временный и осознанно такой: канонический путь — `scm`-неймспейс с
 * `SourceControl.quickDiffProvider`, но он в `vscode.d.ts` ещё закомментирован
 * (см. docs/TODO/Diff.md, пункт F). Граница владения при этом уже правильная —
 * решение «есть ли оригинал» принимает расширение, — поэтому переход на `scm`
 * будет заменой реализации этого класса, а не переделкой `QuickDiffService`.
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
