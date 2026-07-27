const FAILING_OUTCOMES = new Set(['fail', 'blocked', 'verdict:fail']);
const TERMINAL_GRAPH_STATUSES = new Set(['succeeded', 'failed', 'budget-exhausted']);

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Invalid benchmark manifest: ${message}`);
    }
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function round(value, digits = 2) {
    if (!isFiniteNumber(value)) {
        return undefined;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function median(values) {
    if (!values.length) {
        return undefined;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, percentileValue) {
    if (!values.length) {
        return undefined;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
    return sorted[index];
}

function safeDivide(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : undefined;
}

/** Wilson score interval for a binary completion rate. */
export function wilsonInterval(successes, total, z = 1.96) {
    if (total <= 0) {
        return undefined;
    }
    const probability = successes / total;
    const denominator = 1 + (z * z) / total;
    const centre = probability + (z * z) / (2 * total);
    const margin = z * Math.sqrt((probability * (1 - probability) + (z * z) / (4 * total)) / total);
    return {
        low: Math.max(0, (centre - margin) / denominator),
        high: Math.min(1, (centre + margin) / denominator),
    };
}

function normalizeGraph(run) {
    if (run.graph) {
        return run.graph;
    }
    if (run.qaapWorkflow?.run) {
        return {
            status: run.qaapWorkflow.run.status,
            terminationReason: run.qaapWorkflow.run.terminationReason,
            nodeRuns: run.qaapWorkflow.run.nodeRuns,
            visits: run.qaapWorkflow.run.visits,
            trace: run.qaapWorkflow.trace,
        };
    }
    return undefined;
}

function unionDuration(intervals) {
    if (!intervals.length) {
        return 0;
    }
    const sorted = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
    let total = 0;
    let start = sorted[0].start;
    let end = sorted[0].end;
    for (const interval of sorted.slice(1)) {
        if (interval.start <= end) {
            end = Math.max(end, interval.end);
        } else {
            total += end - start;
            start = interval.start;
            end = interval.end;
        }
    }
    return total + end - start;
}

function peakParallelism(intervals) {
    const events = [];
    for (const interval of intervals) {
        events.push({ at: interval.start, delta: 1 });
        events.push({ at: interval.end, delta: -1 });
    }
    // Finish events sort first at equal timestamps: adjacent nodes are not concurrent.
    events.sort((left, right) => left.at - right.at || left.delta - right.delta);
    let active = 0;
    let peak = 0;
    for (const event of events) {
        active += event.delta;
        peak = Math.max(peak, active);
    }
    return peak;
}

function reviewerIndependence(trace) {
    const writers = new Set(trace
        .filter(entry => entry.kind === 'agent-turn' && /implement|writer|fix/i.test(entry.nodeId) && entry.agentRef)
        .map(entry => entry.agentRef));
    const judges = trace
        .filter(entry => entry.kind === 'agent-turn' && /judge|review/i.test(entry.nodeId) && entry.agentRef)
        .map(entry => entry.agentRef);
    if (!judges.length || !writers.size) {
        return undefined;
    }
    return judges.every(agentRef => !writers.has(agentRef));
}

/** Derive graph diagnostics from Qaap's public workflow trace contract. */
export function analyzeGraph(run) {
    const graph = normalizeGraph(run);
    const trace = Array.isArray(graph?.trace) ? graph.trace : [];
    if (!graph || !trace.length) {
        return undefined;
    }
    const intervals = trace.flatMap(entry => {
        const start = entry.startedAt;
        const end = entry.finishedAt;
        return isFiniteNumber(start) && isFiniteNumber(end) && end >= start ? [{ start, end }] : [];
    });
    const totalNodeTimeMs = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
    const activeTimeMs = unionDuration(intervals);
    const wallTimeMs = run.timing?.wallTimeMs;
    const nodeCounts = new Map();
    for (const entry of trace) {
        nodeCounts.set(entry.nodeId, (nodeCounts.get(entry.nodeId) ?? 0) + 1);
    }
    const repeatedNodeRuns = [...nodeCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    const failedSteps = trace.filter(entry => FAILING_OUTCOMES.has(entry.outcome)).length;
    const terminalTrace = TERMINAL_GRAPH_STATUSES.has(graph.status);
    return {
        status: graph.status,
        terminationReason: graph.terminationReason,
        traceEntries: trace.length,
        nodeRuns: isFiniteNumber(graph.nodeRuns) ? graph.nodeRuns : trace.length,
        uniqueNodes: nodeCounts.size,
        failedSteps,
        failedStepRate: round(safeDivide(failedSteps, trace.length)),
        recoveredFailure: graph.status === 'succeeded' && failedSteps > 0,
        repeatedNodeRuns,
        retryOverheadRate: round(safeDivide(repeatedNodeRuns, trace.length)),
        totalNodeTimeMs,
        activeTimeMs,
        activeUtilization: round(
            isFiniteNumber(wallTimeMs) ? safeDivide(activeTimeMs, wallTimeMs) : undefined,
        ),
        averageParallelism: round(safeDivide(totalNodeTimeMs, activeTimeMs)),
        peakParallelism: peakParallelism(intervals),
        reviewerIndependent: reviewerIndependence(trace),
        budgetExhausted: graph.status === 'budget-exhausted',
        traceTerminal: terminalTrace,
    };
}

function validateManifest(manifest) {
    assert(manifest && typeof manifest === 'object', 'the root must be an object');
    assert(manifest.schemaVersion === 1, 'schemaVersion must be 1');
    assert(manifest.suite && typeof manifest.suite === 'object', 'suite is required');
    assert(typeof manifest.suite.id === 'string' && manifest.suite.id.trim(), 'suite.id is required');
    assert(Array.isArray(manifest.suite.tasks) && manifest.suite.tasks.length, 'suite.tasks must not be empty');
    assert(Array.isArray(manifest.runs), 'runs must be an array');

    const taskIds = new Set();
    for (const task of manifest.suite.tasks) {
        assert(typeof task.id === 'string' && task.id.trim(), 'every task needs an id');
        assert(!taskIds.has(task.id), `duplicate task id "${task.id}"`);
        taskIds.add(task.id);
        if (task.weight !== undefined) {
            assert(isFiniteNumber(task.weight) && task.weight > 0, `task "${task.id}" weight must be positive`);
        }
        const threshold = task.completionThreshold ?? manifest.suite.completionThreshold ?? 1;
        assert(isFiniteNumber(threshold) && threshold >= 0 && threshold <= 1,
            `task "${task.id}" completionThreshold must be between 0 and 1`);
        const budgets = task.budgets ?? {};
        if (budgets.wallTimeMs !== undefined) {
            assert(isFiniteNumber(budgets.wallTimeMs) && budgets.wallTimeMs > 0,
                `task "${task.id}" budgets.wallTimeMs must be positive`);
        }
        if (budgets.costUsd !== undefined) {
            assert(isFiniteNumber(budgets.costUsd) && budgets.costUsd >= 0,
                `task "${task.id}" budgets.costUsd must be non-negative`);
        }
        if (budgets.humanInterventions !== undefined) {
            assert(Number.isInteger(budgets.humanInterventions) && budgets.humanInterventions >= 0,
                `task "${task.id}" budgets.humanInterventions must be a non-negative integer`);
        }
    }

    const runIds = new Set();
    const repetitions = new Set();
    for (const run of manifest.runs) {
        assert(typeof run.id === 'string' && run.id.trim(), 'every run needs an id');
        assert(!runIds.has(run.id), `duplicate run id "${run.id}"`);
        runIds.add(run.id);
        assert(taskIds.has(run.taskId), `run "${run.id}" references unknown task "${run.taskId}"`);
        assert(typeof run.system === 'string' && run.system.trim(), `run "${run.id}" needs a system`);
        assert(Number.isInteger(run.repetition) && run.repetition >= 1,
            `run "${run.id}" repetition must be a positive integer`);
        assert(isFiniteNumber(run.oracle?.score) && run.oracle.score >= 0 && run.oracle.score <= 1,
            `run "${run.id}" oracle.score must be between 0 and 1`);
        assert(typeof run.safety?.passed === 'boolean', `run "${run.id}" safety.passed is required`);
        assert(Number.isInteger(run.humanInterventions) && run.humanInterventions >= 0,
            `run "${run.id}" humanInterventions must be a non-negative integer`);
        if (run.timing?.wallTimeMs !== undefined) {
            assert(isFiniteNumber(run.timing.wallTimeMs) && run.timing.wallTimeMs >= 0,
                `run "${run.id}" timing.wallTimeMs must be non-negative`);
        }
        if (run.usage?.costUsd !== undefined) {
            assert(isFiniteNumber(run.usage.costUsd) && run.usage.costUsd >= 0,
                `run "${run.id}" usage.costUsd must be non-negative`);
        }
        const repetitionKey = [
            run.track ?? 'unspecified',
            run.system,
            run.configuration ?? 'default',
            run.model ?? 'unspecified',
            run.taskId,
            run.repetition,
        ].join('\u0000');
        assert(!repetitions.has(repetitionKey),
            `duplicate repetition ${run.repetition} for ${run.system}/${run.taskId}`);
        repetitions.add(repetitionKey);
    }
}

function systemKey(run) {
    return [
        run.track ?? 'unspecified',
        run.system,
        run.configuration ?? 'default',
        run.model ?? 'unspecified',
    ].join('\u0000');
}

function runResult(run, task, suite) {
    const budgets = task.budgets ?? {};
    const threshold = task.completionThreshold ?? suite.completionThreshold ?? 1;
    const allowedHumanInterventions = budgets.humanInterventions ?? 0;
    const autonomous = run.humanInterventions <= allowedHumanInterventions;
    const safe = run.safety.passed;
    const oraclePassed = run.oracle.score >= threshold;
    const withinTimeBudget = budgets.wallTimeMs === undefined
        ? undefined
        : isFiniteNumber(run.timing?.wallTimeMs) && run.timing.wallTimeMs <= budgets.wallTimeMs;
    const withinCostBudget = budgets.costUsd === undefined
        ? undefined
        : isFiniteNumber(run.usage?.costUsd) && run.usage.costUsd <= budgets.costUsd;
    const withinBudgets = [withinTimeBudget, withinCostBudget]
        .filter(value => value !== undefined)
        .every(Boolean);
    return {
        ...run,
        autonomous,
        safe,
        oraclePassed,
        validCompletion: oraclePassed && safe && autonomous && withinBudgets,
        withinTimeBudget,
        withinCostBudget,
        withinBudgets,
        graphMetrics: analyzeGraph(run),
    };
}

function aggregateGraphs(runs) {
    const graphs = runs.map(run => run.graphMetrics).filter(Boolean);
    if (!graphs.length) {
        return undefined;
    }
    const numeric = key => graphs.map(graph => graph[key]).filter(isFiniteNumber);
    const booleans = key => graphs.map(graph => graph[key]).filter(value => typeof value === 'boolean');
    const reviewerChecks = booleans('reviewerIndependent');
    return {
        tracedRuns: graphs.length,
        averageNodeRuns: round(mean(numeric('nodeRuns'))),
        failedStepRate: round(mean(numeric('failedStepRate'))),
        recoveredFailureRate: round(mean(booleans('recoveredFailure').map(Number))),
        retryOverheadRate: round(mean(numeric('retryOverheadRate'))),
        averageParallelism: round(mean(numeric('averageParallelism'))),
        peakParallelism: Math.max(...numeric('peakParallelism')),
        activeUtilization: round(mean(numeric('activeUtilization'))),
        reviewerIndependenceRate: reviewerChecks.length ? round(mean(reviewerChecks.map(Number))) : undefined,
        budgetExhaustedRuns: booleans('budgetExhausted').filter(Boolean).length,
        nonTerminalTraces: booleans('traceTerminal').filter(value => !value).length,
    };
}

function aggregateSystem(groupRuns, tasks, suite) {
    const first = groupRuns[0];
    const taskResults = [];
    for (const task of tasks) {
        const runs = groupRuns.filter(run => run.taskId === task.id);
        const weight = task.weight ?? 1;
        taskResults.push({
            taskId: task.id,
            weight,
            runs: runs.length,
            validCompletionRate: runs.length ? mean(runs.map(run => Number(run.validCompletion))) : 0,
            oracleScore: runs.length ? mean(runs.map(run => run.oracle.score)) : 0,
            passAt1: runs.find(run => run.repetition === 1)?.validCompletion ?? false,
        });
    }
    const totalWeight = taskResults.reduce((sum, task) => sum + task.weight, 0);
    const weighted = key => taskResults.reduce((sum, task) => sum + task.weight * task[key], 0) / totalWeight;
    const completions = groupRuns.filter(run => run.validCompletion).length;
    const interval = wilsonInterval(completions, groupRuns.length);
    const costs = groupRuns.map(run => run.usage?.costUsd).filter(isFiniteNumber);
    const times = groupRuns.map(run => run.timing?.wallTimeMs).filter(isFiniteNumber);
    const firstOutputs = groupRuns.map(run => run.timing?.firstOutputMs).filter(isFiniteNumber);
    const tokens = groupRuns.map(run => run.usage?.totalTokens).filter(isFiniteNumber);
    const budgetedRuns = groupRuns.filter(run =>
        run.withinTimeBudget !== undefined || run.withinCostBudget !== undefined);
    return {
        key: systemKey(first),
        track: first.track ?? 'unspecified',
        system: first.system,
        configuration: first.configuration ?? 'default',
        model: first.model ?? 'unspecified',
        score: round(100 * weighted('validCompletionRate')),
        passAt1: round(100 * weighted('passAt1')),
        oracleScore: round(100 * weighted('oracleScore')),
        taskCoverage: round(groupRuns.length
            ? new Set(groupRuns.map(run => run.taskId)).size / tasks.length
            : 0),
        runs: groupRuns.length,
        validCompletions: completions,
        completionInterval95: interval && {
            low: round(100 * interval.low),
            high: round(100 * interval.high),
        },
        safeRunRate: round(mean(groupRuns.map(run => Number(run.safe)))),
        autonomousRunRate: round(mean(groupRuns.map(run => Number(run.autonomous)))),
        budgetPassRate: budgetedRuns.length
            ? round(mean(budgetedRuns.map(run => Number(run.withinBudgets))))
            : undefined,
        medianWallTimeMs: median(times),
        p95WallTimeMs: percentile(times, 95),
        medianFirstOutputMs: median(firstOutputs),
        totalCostUsd: round(costs.reduce((sum, cost) => sum + cost, 0), 4),
        costPerValidCompletionUsd: round(
            completions > 0 && costs.length ? costs.reduce((sum, cost) => sum + cost, 0) / completions : undefined,
            4,
        ),
        medianTotalTokens: median(tokens),
        graph: aggregateGraphs(groupRuns),
        tasks: taskResults,
    };
}

function compareSystems(left, right) {
    return right.score - left.score
        || right.passAt1 - left.passAt1
        || (left.medianWallTimeMs ?? Number.POSITIVE_INFINITY)
            - (right.medianWallTimeMs ?? Number.POSITIVE_INFINITY)
        || (left.costPerValidCompletionUsd ?? Number.POSITIVE_INFINITY)
            - (right.costPerValidCompletionUsd ?? Number.POSITIVE_INFINITY)
        || left.system.localeCompare(right.system);
}

function buildWarnings(manifest, systems) {
    const warnings = [];
    for (const system of systems) {
        if (system.taskCoverage < 1) {
            warnings.push(`${system.system}/${system.configuration}: task coverage is ${round(system.taskCoverage * 100)}%. Missing tasks score zero.`);
        }
        const underRepeated = system.tasks.filter(task => task.runs < 5).map(task => task.taskId);
        if (underRepeated.length) {
            warnings.push(`${system.system}/${system.configuration}: fewer than 5 repetitions for ${underRepeated.join(', ')}; uncertainty will be high.`);
        }
        if (system.medianWallTimeMs === undefined) {
            warnings.push(`${system.system}/${system.configuration}: wall time was not reported.`);
        }
        if (system.totalCostUsd === 0) {
            warnings.push(`${system.system}/${system.configuration}: cost was not reported or was zero.`);
        }
    }
    return warnings;
}

/**
 * Rank systems by validated completion. Time and cost are tie-breakers, never substitutes for
 * finishing the task.
 */
export function evaluateBenchmark(manifest) {
    validateManifest(manifest);
    const taskById = new Map(manifest.suite.tasks.map(task => [task.id, task]));
    const evaluatedRuns = manifest.runs.map(run => runResult(run, taskById.get(run.taskId), manifest.suite));
    const grouped = new Map();
    for (const run of evaluatedRuns) {
        const key = systemKey(run);
        grouped.set(key, [...(grouped.get(key) ?? []), run]);
    }
    const systems = [...grouped.values()]
        .map(runs => aggregateSystem(runs, manifest.suite.tasks, manifest.suite))
        .sort(compareSystems);
    const tracks = [...new Set(systems.map(system => system.track))].map(track => ({
        track,
        systems: systems.filter(system => system.track === track).sort(compareSystems),
    }));
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        suite: {
            id: manifest.suite.id,
            name: manifest.suite.name ?? manifest.suite.id,
            tasks: manifest.suite.tasks.length,
            completionThreshold: manifest.suite.completionThreshold ?? 1,
        },
        rankingRule: 'validated completion score; pass@1, median wall time, then cost per valid completion as tie-breakers',
        systems,
        tracks,
        warnings: buildWarnings(manifest, systems),
    };
}

function percent(value) {
    return isFiniteNumber(value) ? `${round(value * 100, 1)}%` : '—';
}

function scorePercent(value) {
    return isFiniteNumber(value) ? `${round(value, 1)}%` : '—';
}

function formatDuration(value) {
    if (!isFiniteNumber(value)) {
        return '—';
    }
    if (value < 1000) {
        return `${Math.round(value)}ms`;
    }
    if (value < 60_000) {
        return `${round(value / 1000, 1)}s`;
    }
    return `${round(value / 60_000, 1)}m`;
}

function formatMoney(value) {
    return isFiniteNumber(value) ? `$${value.toFixed(value < 1 ? 4 : 2)}` : '—';
}

function escapeCell(value) {
    return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Render a compact report suitable for an event scorecard or CI artifact. */
export function renderBenchmarkMarkdown(report) {
    const lines = [
        `# ${report.suite.name}`,
        '',
        `Validated completion benchmark: ${report.suite.tasks} tasks. Ranking: ${report.rankingRule}.`,
        '',
    ];
    for (const track of report.tracks) {
        lines.push(
            `## Track: ${track.track}`,
            '',
            '| System | Configuration | Model | Score | Pass@1 | Oracle | Coverage | Runs | 95% CI | Median time | Cost / success |',
            '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        );
        for (const system of track.systems) {
            const interval = system.completionInterval95
                ? `${system.completionInterval95.low}–${system.completionInterval95.high}%`
                : '—';
            lines.push(`| ${escapeCell(system.system)} | ${escapeCell(system.configuration)} | ${escapeCell(system.model)}`
                + ` | ${scorePercent(system.score)} | ${scorePercent(system.passAt1)} | ${scorePercent(system.oracleScore)}`
                + ` | ${percent(system.taskCoverage)} | ${system.runs} | ${interval}`
                + ` | ${formatDuration(system.medianWallTimeMs)} | ${formatMoney(system.costPerValidCompletionUsd)} |`);
        }
        lines.push('');
    }

    const graphed = report.systems.filter(system => system.graph);
    if (graphed.length) {
        lines.push(
            '## Graph diagnostics',
            '',
            'Compare these only when systems expose equivalent structured traces. They are diagnostics, not leaderboard points.',
            '',
            '| System | Traced | Avg nodes | Failed steps | Retry overhead | Avg parallelism | Peak | Active utilization | Independent review | Budget exhausted |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        );
        for (const system of graphed) {
            const graph = system.graph;
            lines.push(`| ${escapeCell(system.system)} / ${escapeCell(system.configuration)} | ${graph.tracedRuns}`
                + ` | ${graph.averageNodeRuns ?? '—'} | ${percent(graph.failedStepRate)}`
                + ` | ${percent(graph.retryOverheadRate)} | ${graph.averageParallelism ?? '—'}`
                + ` | ${graph.peakParallelism ?? '—'} | ${percent(graph.activeUtilization)}`
                + ` | ${percent(graph.reviewerIndependenceRate)} | ${graph.budgetExhaustedRuns} |`);
        }
        lines.push('');
    }
    if (report.warnings.length) {
        lines.push('## Integrity warnings', '', ...report.warnings.map(warning => `- ${warning}`), '');
    }
    return `${lines.join('\n')}\n`;
}
