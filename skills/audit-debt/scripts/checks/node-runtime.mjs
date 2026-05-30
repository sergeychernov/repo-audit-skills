const looseMajor = (raw) => {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/^v?(\d+)/);
    return m ? Number(m[1]) : null;
};

/**
 * @param {import('./types.mjs').CheckContext} ctx
 */
export function runNodeRuntimeCheck(ctx) {
    const findings = [];
    const nodeRaw = ctx.profile.stack?.runtime?.node;
    if (!nodeRaw) return findings;

    const nodeMajor = looseMajor(nodeRaw);
    const nodeRef = ctx.assets.referenceVersions.runtimes.node;
    if (nodeMajor == null) return findings;

    if (nodeMajor <= nodeRef.eolCutoff - 2) {
        findings.push({
            id: 'node_eol',
            checkId: 'node_runtime',
            category: 'runtime',
            current: nodeRaw,
            target: `${nodeRef.currentLts}.x`,
            penalty: 15,
            criticality: 'critical',
            message: `Node ${nodeMajor} is past security support (EOL cutoff: ${nodeRef.eolCutoff}).`,
        });
    } else if (nodeMajor < nodeRef.previousLts) {
        findings.push({
            id: 'node_outdated',
            checkId: 'node_runtime',
            category: 'runtime',
            current: nodeRaw,
            target: `${nodeRef.currentLts}.x`,
            penalty: 6,
            criticality: 'high',
            message: `Node ${nodeMajor} is two or more majors behind current LTS (${nodeRef.currentLts}).`,
        });
    } else if (nodeMajor < nodeRef.currentLts) {
        findings.push({
            id: 'node_outdated',
            checkId: 'node_runtime',
            category: 'runtime',
            current: nodeRaw,
            target: `${nodeRef.currentLts}.x`,
            penalty: 3,
            criticality: 'medium',
            message: `Node ${nodeMajor} is one major behind current LTS (${nodeRef.currentLts}).`,
        });
    }

    return findings;
}
