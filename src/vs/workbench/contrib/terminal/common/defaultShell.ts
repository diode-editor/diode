// `getDefaultProfile` эталона, урезанный до пути. Шов в common: шелл знает только node-слой, а
// задачам его имя нужно до создания терминала — по нему выбираются экранирование и `-c`.

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Путь шелла, которым терминал запустился бы без явного `shellPath`. */
export type DefaultShellResolver = () => string;

export const DefaultShellResolverDIToken = token<DefaultShellResolver>("DefaultShellResolver");
