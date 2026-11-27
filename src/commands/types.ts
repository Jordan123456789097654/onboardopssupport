import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export type Command = {
  json: RESTPostAPIChatInputApplicationCommandsJSONBody;
  run: (i: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (i: AutocompleteInteraction) => Promise<void>;
};
