import { runCursorRulesCheck } from './cursor-rules.mjs';
import { runNodeRuntimeCheck } from './node-runtime.mjs';
import { runStackToolsCheck } from './stack-tools.mjs';
import { runYarnPackageManagerCheck } from './yarn-package-manager.mjs';
import { runProfileFreshnessCheck } from './profile-freshness.mjs';

/** @type {Record<string, (ctx: import('./types.mjs').CheckContext) => Array<Record<string, unknown>>>} */
export const CHECK_RUNNERS = {
    cursor_rules: runCursorRulesCheck,
    node_runtime: runNodeRuntimeCheck,
    stack_tools: runStackToolsCheck,
    yarn_package_manager: runYarnPackageManagerCheck,
    profile_freshness: runProfileFreshnessCheck,
};
