# QAAP Rioja QA Issues

Repositorio objetivo: `juancristobalgd1/qaap`

Contexto:
- Flujo probado: app desde cero -> proyecto nuevo -> prompt Rioja -> run/preview.
- Resultado: el sistema falla en el handoff agente -> run/preview, el agente no cumple el prompt y la UX móvil comunica mal el estado real.

## Issue 1

### Title
Run/Preview fails when the agent creates the app inside a subfolder

### Labels
`bug`, `agent`, `preview`, `high-priority`

### Body
#### Summary
QAAP fails to run or preview the generated app when the agent scaffolds the project inside a child directory instead of the workspace root.

#### Steps To Reproduce
1. Open QAAP in browser mode from a clean state.
2. Start with an empty workspace.
3. Ask the agent to create a landing page for Rioja wines using Vite/React.
4. Wait for scaffolding to finish.
5. Ask the agent to run the app or trigger the integrated preview flow.

#### Actual Result
QAAP runs `npm run dev` from the workspace root, where no `package.json` exists.
The generated app actually lives in a child directory such as `rioja-wines-landing-page/`.
Preview flow fails even though the generated app is runnable.

#### Expected Result
QAAP should detect the generated app root automatically and run the dev server from the correct directory.

#### Impact
This breaks the main creation -> run -> preview workflow and makes the product feel unreliable in a core demo scenario.

#### Evidence
- Workspace root had no `package.json`
- Generated app existed in `rioja-wines-landing-page/`
- Manual run from the child directory worked
- Integrated preview probe worked once Vite was started from the correct cwd

## Issue 2

### Title
Agent conversation remains stuck in `streaming` after the turn has effectively failed

### Labels
`bug`, `agent`, `timeline`, `high-priority`

### Body
#### Summary
The conversation backend can remain in `streaming` state even after the agent has already failed to complete the task successfully.

#### Steps To Reproduce
1. Reproduce the Rioja landing generation flow.
2. Let the agent scaffold the project and attempt run/preview.
3. Inspect conversation status through the UI or backend endpoint.

#### Actual Result
The conversation remains in `streaming` with partial progress instead of transitioning to a terminal state.

#### Expected Result
The conversation should transition to `failed` or `settled` with a concise error reason and actionable next step.

#### Impact
Users cannot tell if the agent is still working, blocked, or done. This badly hurts trust and makes the timeline feel misleading.

#### Evidence
- Conversation summary showed `status: "streaming"` with progress near completion
- The run step had already failed due to wrong cwd

## Issue 3

### Title
Agent output does not satisfy the prompt and returns a default Vite starter instead

### Labels
`bug`, `agent-quality`, `high-priority`

### Body
#### Summary
The agent accepted a prompt for a premium Rioja landing page but produced an almost untouched Vite/React starter.

#### Steps To Reproduce
1. Ask the agent to create a responsive premium Rioja landing page with hero, featured products, history section, contact form and premium styling.
2. Wait for the generated project.
3. Inspect the resulting app and source files.

#### Actual Result
The output is a generic starter page with React/Vite branding, default counter, default documentation links and no meaningful Rioja-focused implementation.

#### Expected Result
The output should include the requested information architecture and a visually coherent premium landing page.

#### Impact
This is a direct failure of task understanding and generation quality.

#### Evidence
- Default `Get started`
- Default Vite/React logos
- Counter button still present
- README still describes the stock React + Vite template

## Issue 4

### Title
Agent trace does not explain the real root cause when run/preview fails

### Labels
`ux`, `agent`, `timeline`, `high-priority`

### Body
#### Summary
The trace/timeline does not clearly tell the user that the app was created in a subdirectory and that QAAP is running commands from the wrong cwd.

#### Actual Result
The user sees a vague broken flow, a mostly empty UI surface, and a stuck task.

#### Expected Result
Trace should explicitly surface messages like:
- "Created app in `rioja-wines-landing-page/`"
- "Run failed because no `package.json` was found in workspace root"
- "Suggested fix: switch preview root to generated project directory"

#### Impact
Without this explanation, the system feels confused rather than transparent.

## Issue 5

### Title
Mobile `Agents` surface feels empty and does not communicate active progress

### Labels
`ux`, `mobile`, `medium-priority`

### Body
#### Summary
During the Rioja flow, the main mobile `Agents` view displayed large empty areas and did not convey useful work-in-progress information.

#### Actual Result
The page feels visually blank even while backend activity is happening.

#### Expected Result
The mobile shell should show current task, files created, active directory, recent tool actions and explicit status.

#### Impact
This makes the app feel slower and less trustworthy than it really is.

## Issue 6

### Title
Agent invokes unavailable subagents instead of using a valid execution path

### Labels
`bug`, `agent-quality`, `medium-priority`

### Body
#### Summary
The agent trace showed attempts to call unavailable subagent types such as `web-dev` and `react-debug`.

#### Actual Result
The agent spends time trying non-existent paths, then falls back poorly and degrades the turn quality.

#### Expected Result
The orchestration layer should validate subagent availability before invocation and avoid dead-end tool strategies.

#### Impact
This creates unnecessary delay, noisy traces and lower confidence in tool orchestration.

## Issue 7

### Title
Run/preview orchestration does not infer the generated project root after scaffolding

### Labels
`bug`, `preview`, `agent`, `high-priority`

### Body
#### Summary
QAAP does not appear to register the output directory created by scaffold commands like `create-vite`.

#### Actual Result
Subsequent run/preview actions are still attached to the original workspace root instead of the newly created app directory.

#### Expected Result
QAAP should automatically track the most likely runnable root after scaffolding and use it as the default preview target.

#### Impact
This is the technical root of a large class of "agent built the app but preview is broken" failures.

## Issue 8

### Title
Reload returns the user to an inconsistent mobile/desktop shell state

### Labels
`ux`, `mobile`, `medium-priority`

### Body
#### Summary
After reload, the product does not always preserve a consistent Work Hub-first mobile experience.

#### Actual Result
The app can fall back toward a more classic IDE-like surface instead of clearly restoring the intended mobile hub flow.

#### Expected Result
Reload should restore the same mental model and preferred surface consistently.

#### Impact
This weakens the "mobile-first agentic IDE" positioning.

## Issue 9

### Title
Backend startup shows plugin/localization errors on a fresh QAAP browser run

### Labels
`bug`, `startup`, `medium-priority`

### Body
#### Summary
QAAP starts with repeated plugin localization errors and missing local plugin warnings.

#### Actual Result
The backend logs include missing plugin directory warnings and repeated localization bundle errors.

#### Expected Result
Fresh startup should be quiet or downgrade these issues cleanly without noisy repeated errors.

#### Impact
Even if non-fatal, this hurts the first impression and makes the product feel less polished.

## Issue 10

### Title
Post-generation quality gate is missing for simple web generation tasks

### Labels
`agent-quality`, `enhancement`, `high-priority`

### Body
#### Summary
QAAP should validate whether the generated output actually matches the requested structure before marking the task as effectively complete.

#### Actual Result
The system accepted a low-quality starter template as if it were a valid completion path.

#### Expected Result
For prompts like landing pages, a lightweight quality gate should verify:
- requested sections exist
- branding/content changed from starter template
- obvious placeholder UI is removed
- run/build path is known

#### Impact
This would prevent low-quality completions from reaching the user and would force the agent to self-correct earlier.

## Suggested `gh` Commands

Una vez que `gh auth login` vuelva a estar válido, estas issues se pueden subir con comandos de este estilo:

```bash
gh issue create --repo juancristobalgd1/qaap --title "Run/Preview fails when the agent creates the app inside a subfolder" --body-file /tmp/issue-1.md
```

También se pueden subir en lote con un pequeño script que lea este documento y genere archivos temporales por issue.
