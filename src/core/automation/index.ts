/** Public API of the automation feature (see README.md). */
export { useRules, type RulesState, type RunLogEntry, type RuleImportResult } from "./store";
export { dispatch, fireRuleByName } from "./init";
export { TriggerEvaluator, describeTrigger, timeMatches, payloadMatches, processMatches, normalizeAccelerator, TRIGGER_EVENT, type EngineEvent } from "./triggers";
export { validateRule, riskyRuleActions } from "./validate";
export { executeAction } from "./actions";
export { exampleRules } from "./examples";
