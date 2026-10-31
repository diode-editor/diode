import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { DefinitionService } from "./definitionService.ts";
import { DefinitionServiceDIToken } from "./definitionService.ts";
import { parseGoToLocationsArguments } from "./goToLocationsArguments.ts";

export const GoToLocationsCommandContributionDIToken = token<GoToLocationsCommandContribution>(
    "GoToLocationsCommandContribution",
);

/** No title, as upstream's `CommandsRegistry`: they take arguments and stay out of the command palette. */
export class GoToLocationsCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, DefinitionServiceDIToken] as const;

    public constructor(commands: CommandRegistry, definitions: DefinitionService) {
        super();
        const peek = (uri: unknown, position: unknown, locations: unknown, multiple?: unknown): Promise<void> =>
            definitions.goToLocations(parseGoToLocationsArguments(uri, position, locations, multiple, undefined, true));
        this.register(
            commands.register(
                "editor.action.goToLocations",
                (
                    uri: unknown,
                    position: unknown,
                    locations: unknown,
                    multiple?: unknown,
                    noResultsMessage?: unknown,
                    openInPeek?: unknown,
                ) =>
                    definitions.goToLocations(
                        parseGoToLocationsArguments(uri, position, locations, multiple, noResultsMessage, openInPeek),
                    ),
            ),
        );
        this.register(commands.register("editor.action.peekLocations", peek));
        // Upstream registers it as an alias of `peekLocations`; the code lens of many servers uses this id.
        this.register(commands.register("editor.action.showReferences", peek));
    }
}
