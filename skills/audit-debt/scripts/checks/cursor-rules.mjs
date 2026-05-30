import { scanCursorRules } from '../scan-cursor-rules.mjs';

/**
 * @param {import('./types.mjs').CheckContext} ctx
 */
export function runCursorRulesCheck(ctx) {
    const config = ctx.assets.cursorRulesConfig;
    const raw = scanCursorRules(ctx.repoRoot, config);
    return raw.map((f) => ({ ...f, checkId: 'cursor_rules' }));
}
