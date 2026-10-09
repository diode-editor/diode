// Шелл по умолчанию для терминалов, которые строят командную строку сами
// (задачи: `bash -c "<команда>"`), — `ITerminalProfileResolverService.
// getDefaultProfile` эталона, урезанный до пути. Шов в common: какой шелл в
// системе, знает только node-слой (`getSystemShell`), а задачам нужно его имя
// ещё до создания терминала — по нему выбираются экранирование и `-c`.

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Путь шелла, которым терминал запустился бы без явного `shellPath`. */
export type DefaultShellResolver = () => string;

export const DefaultShellResolverDIToken = token<DefaultShellResolver>("DefaultShellResolver");
