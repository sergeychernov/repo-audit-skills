const PROFILE_STALE_DAYS = 90;

/**
 * @param {import('./types.mjs').CheckContext} ctx
 */
export function runProfileFreshnessCheck(ctx) {
    const generatedAt = ctx.profile.generatedAt;
    if (!generatedAt) return [];

    const ageMs = Date.now() - new Date(generatedAt).getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageDays < PROFILE_STALE_DAYS) return [];

    return [
        {
            id: 'profile_stale',
            checkId: 'profile_freshness',
            category: 'audit',
            current: `${ageDays} days old`,
            target: `< ${PROFILE_STALE_DAYS} days`,
            penalty: 0,
            criticality: 'info',
            message:
                'Audit profile is stale — re-run audit-init so stack-aware checks use current dependencies.',
            detail: { generatedAt, ageDays },
        },
    ];
}
