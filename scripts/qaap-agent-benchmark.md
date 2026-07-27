# Qaap agent benchmark

This benchmark answers one question first: **did the system finish the engineering task without
unsafe behavior or undeclared human help?** UI polish, fast first output, and a busy-looking graph do
not compensate for a failing hidden test.

## Two comparison tracks

Never mix these tracks in one ranking:

1. **Harness-controlled** — Qaap, Cursor, and Claude Code use the same model, repository snapshot,
   prompt, network policy, machine class, time limit, and cost accounting. This isolates the agent
   harness.
2. **Product-native** — each product uses its strongest supported/default configuration. This
   measures the product a competitor would actually demonstrate, but it does not isolate the graph
   from the model.

The manifest's `track` field keeps the generated scorecards separate.

## Ranking contract

Each task has a hidden deterministic oracle and fixed budgets. A run counts as a valid completion
only when all five conditions hold:

- `oracle.score` reaches the task's `completionThreshold`;
- `safety.passed` is true;
- `humanInterventions` does not exceed the task budget.
- reported wall time does not exceed `budgets.wallTimeMs`, when defined;
- reported cost does not exceed `budgets.costUsd`, when defined.

Missing time or cost fails closed when the corresponding task budget exists. Missing tasks also score
zero. The main score is the weighted valid-completion rate across the complete suite. Pass@1, median
wall time, and cost per valid completion are tie-breakers, in that order. Cost or speed never award
points to a failed task.

Here, Pass@1 is the weighted result of repetition `1` for every task. The main score uses every
repetition and therefore estimates reliability rather than rewarding one lucky rollout.

Run at least five repetitions per task and publish the 95% confidence interval. Use fresh,
containerized repository snapshots and hidden tests. Keep a rotating private holdout for the event;
do not tune prompts or routing against that holdout.

## Suite design

Use at least 40 private tasks, balanced across:

- bug fixes with a reproducible failure;
- feature implementation with integration tests;
- multi-file refactors with behavior-preservation checks;
- test creation where mutation testing detects weak tests;
- frontend/mobile work with DOM, accessibility, and visual oracles;
- repository operations such as resolving conflicts, dependency upgrades, and CI repair.

Add public external suites as secondary evidence. [SWE-bench](https://github.com/SWE-bench/SWE-bench)
tests issue resolution against real repositories in reproducible environments.
[Terminal-Bench](https://www.tbench.ai/benchmarks) broadens the evaluation beyond Python issue
repair. The private Qaap suite remains the event decision set because a public benchmark can be
overfit or contaminated.

Every task should define:

- an immutable base commit or container digest;
- the exact user prompt;
- hidden pass/fail tests and optional partial-credit checks;
- wall-time, cost, network, and human-intervention budgets;
- forbidden files/actions and a safety oracle;
- a difficulty label and task category.

## Graph diagnostics

Qaap's workflow API already returns `run` plus a structured `trace`. Put that response directly in a
run's `qaapWorkflow` field. The scorer derives:

- failed-step and retry-overhead rates;
- recovered failures;
- total node work, active-time utilization, average and peak parallelism;
- independent-review routing when writer and judge identities are observable;
- budget exhaustion and non-terminal traces.

These metrics explain *why* Qaap won or lost, but they are not leaderboard points. Cursor and Claude
Code may not expose an equivalent graph, so cross-product comparison must use observable outcomes,
time, cost, tool actions, and human interventions.

Run four Qaap ablations on the same tasks:

1. one linear agent;
2. goal plus deterministic verification;
3. parallel exploration plus implementation;
4. goal, verification fix-loop, and independent review.

Keep a graph feature only when it raises validated completion enough to justify its added latency
and cost. In particular, measure whether parallel exploration shortens the wall clock, whether fix
loops recover real failures, and whether independent review catches defects that hidden tests later
confirm.

## Usage

### Run agents and build the results automatically

First validate the deterministic self-test plan:

```sh
npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-runner.example.json \
    --dry-run
```

Then execute it. The explicit host flag prevents a benchmark file from silently launching an
autonomous coding agent:

```sh
npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-runner.example.json \
    --output test-results/qaap-agent-benchmark/self-test \
    --allow-host-agent-execution
```

This produces `runs.json`, `report.json`, `scorecard.md`, and one auditable artifact directory per
run containing the disposable workspace, prompt, agent logs, oracle logs, and normalized result.
Workspaces are retained by default. Add `--discard-workspaces` only when the logs and final reports
are enough.

The live smoke manifest contains native adapters for Qaap, Cursor Agent, and Claude Code:

```sh
# Terminal 1: local Qaap workflow API with development auth bypass.
QAAP_SKIP_AUTH=1 npm run start:browser

# Terminal 2: validate first, then deliberately launch the three real systems.
npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-live.example.json \
    --dry-run

npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-live.example.json \
    --output test-results/qaap-agent-benchmark/live-smoke \
    --allow-host-agent-execution
```

The live file is a one-task integration smoke test, not evidence that one product beats another.
Replace its task list with the private suite before publishing a comparison. Run it in a disposable
VM or container: headless agents can execute commands, and a copied workspace is reproducibility,
not an operating-system security boundary.

### Bounded security-audit calibration

The seeded security fixture measures a read-only deliverable instead of repository edits. Its oracle
grades three independent dimensions: whether both reachable vulnerabilities were found, whether the
report contains reproducible evidence and explicit verification limits, and whether severity and
false-positive calibration survived two safe decoys. The fixture is public calibration material,
not a private event holdout and not proof of product superiority.

This read-only task enables `strictWorkspaceSnapshot`: only `.git` metadata is excluded from the
before/after content snapshot, so writes hidden under `dist`, `build`, or `node_modules` still fail
the safety oracle.

Qaap uses the `qaap.evidence-audit` graph: three disjoint read-only investigations run in parallel,
then a bounded synthesis is challenged by an independent judge. A rejection loops through revision
and judgment again, bounded by the node and run clocks. Each Qaap node is capped at two minutes and
the whole task at five minutes. Cursor and Claude Code receive the same task, copied workspace,
safety oracle, and total wall-clock budget.

After rebuilding and restarting Qaap so the new workflow template is registered:

```sh
npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-security.example.json \
    --dry-run

npm run qaap:agent-benchmark:run -- \
    --suite scripts/qaap-agent-benchmark-security.example.json \
    --output test-results/qaap-agent-benchmark/security-calibration \
    --allow-host-agent-execution
```

The manifest deliberately requests five repetitions. Publish the generated confidence intervals,
all normalized final reports, and all oracle logs. For the event, replace the public fixture with a
rotating private set containing different vulnerability classes and benign decoys.

Only define a cost budget when every selected adapter reports comparable cost. Claude Code exposes
structured cost, while a Cursor subscription run may not expose a dollar amount in its result.
Missing cost fails closed whenever the task declares `budgets.costUsd`.

### Score an existing results manifest

Copy the example manifest and replace every illustrative result with a real isolated run:

```sh
cp scripts/qaap-agent-benchmark.example.json /tmp/qaap-event-results.json
npm run qaap:agent-benchmark -- \
    --input /tmp/qaap-event-results.json \
    --json-out test-results/qaap-agent-benchmark/report.json \
    --markdown-out test-results/qaap-agent-benchmark/scorecard.md
```

The example numbers are format examples, not benchmark claims.

Use a CI threshold only after the suite is stable:

```sh
npm run qaap:agent-benchmark -- \
    --input test-results/qaap-agent-benchmark/runs.json \
    --fail-below 70 \
    --gate-system Qaap
```

Validate the scorer itself with:

```sh
npm run qaap:agent-benchmark:test
```
