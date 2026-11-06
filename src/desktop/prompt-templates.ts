import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_FIELDS,
  PROMPT_IDS,
  type PromptTemplateState,
  type PromptTemplates,
} from "../bridge/index.js";

/** Applies saved database edits over the config file's templates, one template at a time. */
export function effectivePrompts(
  config: Readonly<PromptTemplates>,
  saved: Readonly<Partial<PromptTemplates>>,
): PromptTemplates {
  return { ...config, ...saved };
}

/** Describes each template's effective text, its source, and what removing an edit restores. */
export function promptStates(
  config: Readonly<PromptTemplates>,
  saved: Readonly<Partial<PromptTemplates>>,
): PromptTemplateState[] {
  return PROMPT_IDS.map((id) => {
    const fallbackSource = config[id] === DEFAULT_PROMPT_TEMPLATES[id] ? "built-in" : "config";
    const edit = saved[id];
    return {
      id,
      fields: [...PROMPT_FIELDS[id]],
      template: edit ?? config[id],
      source: edit === undefined ? fallbackSource : "database",
      fallback: config[id],
      fallbackSource,
    };
  });
}
