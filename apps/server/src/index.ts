// @pbp/server — public entry (SPEC §6.7).
//
// T8 wires `src/main.ts` to `@pbp/paypal` and `@pbp/agent` with these exports; the integration
// tests wire the fakes in `test/` instead (SPEC §7).

export { createServer, startServer, type BuiltServer, type RunningServer, type ServerDeps } from './server.js';
export { resetDemo, HISTORY_INTENT_ID, type ResetDeps } from './reset.js';
export { Runner, templateExplanation, templateSummary, type RunHandle, type RunnerDeps } from './runner.js';
export { Runtime, rebuildOverlay, newEpoch, type Overlay, type SeededHistory } from './runtime.js';
export { buildGateContext } from './gate-context.js';
export { buildBundle, bundleSchema } from './bundle.js';
export { loadDemo, sha256File, sha256Text, vendorOf, type LoadedDemo } from './scenario.js';
export { anchoredClock, fixedClock, wallClock, type Clock } from './clock.js';
export {
  loadConfig,
  readDotEnvFile,
  readEnv,
  missingCredentials,
  credentialMessage,
  environmentProblem,
  REQUIRED_CREDENTIAL_KEYS,
  REPO_ROOT,
  type PollConfig,
  type ServerConfig,
  type ServerEnv,
} from './config.js';
export { validateSchema, type SchemaError } from './json-schema.js';
export { ConflictError, NotFoundError, BadRequestError, messageOf } from './errors.js';
export type {
  AgentPort,
  AgentExplanation,
  Claim,
  CheckResult,
  ComparisonSendRequest,
  ComparisonSendResult,
  HumanAction,
  InboxItem,
  ItemOutcome,
  RunMode,
  RunSummaryInput,
  Scenario,
  SendPayoutTool,
  Totals,
} from './types.js';
