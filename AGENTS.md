# AGENTS.md

This file gives Codex and other coding agents project-specific guidance for working on Swiss Draw.

## Project

Swiss Draw is a Next.js prototype for running Swiss-system tournaments.

Current scope:

- Admin operations console for setup, pairing, match reporting, judge actions, timers, and standings.
- Participant view for checking a current match and reporting a result.
- Browser-only persistence through `localStorage`.
- No production database, authentication, authorization, realtime backend, or audit log yet.

The app is intentionally a prototype, but tournament correctness matters. Treat pairing, standings, and result handling as domain logic, not just UI behavior.

## Tech Stack

- Framework: Next.js App Router
- UI: React client components
- Language: TypeScript
- Styling: global CSS in `app/globals.css`
- State: React state plus browser `localStorage`
- Package manager: npm

Main files:

- `app/page.tsx`: app types, tournament logic, state transitions, admin UI, participant UI.
- `app/globals.css`: visual system and responsive layout.
- `app/layout.tsx`: metadata and root layout.
- `README.md`: user-facing project description and current limitations.
- `dm_competition_rule_20250501.pdf`: official competition-rule source for tournament operations.
- `docs/rules-reference.md`: implementation-oriented extraction plan and rule checklist based on the PDF.

## Competition Rule Source

Use `dm_competition_rule_20250501.pdf` as the source of truth for competition operations.

This document should guide implementation for:

- Swiss draw structure.
- Match result handling.
- Opponent-related tiebreaker calculations.
- Judge actions, warnings, penalties, game losses, match losses, and disqualifications.
- Tournament progress, drop/elimination behavior, and final standings.
- Operational flows that help staff run events smoothly.

Do not guess official rule behavior when implementing domain logic. If a rule is unclear, record the uncertainty in the task notes and prefer a conservative implementation that staff can manually override.

When extracting behavior from the PDF, add a short implementation note near the relevant domain logic or in project documentation. Include the rule topic and enough context for a future agent to verify it against the PDF.

Start from `docs/rules-reference.md` when planning rule-driven work. Keep it updated whenever PDF-derived behavior is confirmed or implemented.

## Local Commands

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build check:

```bash
npm run build
```

Lint check:

```bash
npm run lint
```

Tournament simulation:

```bash
npm run simulate
```

If dependencies are not installed, prefer `npm install` before build or lint work. Do not commit `node_modules`.

## Architecture Notes

The current implementation is concentrated in `app/page.tsx`.

Important domain functions:

- `buildStandings`: computes match records, game records, dropped status, and ranking order.
- `createRound`: creates Swiss pairings, avoids repeat opponents when possible, assigns BYEs, and applies elimination/drop rules.
- `reportMatch`: records match results.
- `applyJudgeAction`: records judge actions and handles penalties.
- `normalizeTournament`: keeps older saved `localStorage` data compatible with the current shape.

Important storage keys:

- `swiss-draw-active-tournament`
- `swiss-draw-tournament:{eventCode}`
- `swiss-draw-settings`

When changing saved state shape, update `normalizeTournament` so existing local data does not break.

## Product Principles

- Admin workflows should be fast, dense, and reliable. Avoid marketing-style pages.
- Participant workflows should be mobile-friendly and require minimal reading.
- Make tournament state transitions explicit and hard to trigger accidentally.
- Favor clear labels over clever wording.
- Keep Japanese UI text natural and consistent.
- Do not add a backend unless the task explicitly includes persistence, auth, realtime sync, or deployment architecture.

## Domain Rules To Preserve

- Prefer pairing players with the same match record.
- Avoid repeat pairings when possible.
- Assign at most one BYE per player when alternatives exist.
- Exclude disqualified players from future pairings.
- Apply elimination mode by loss count.
- Keep `pairingRecordA` and `pairingRecordB` as the snapshot at round start.
- BYE should count as a win.
- Forced losses and judge actions must remain visible in match history.

If a requested change conflicts with these rules, call it out before implementing.

## Current Known Limitations

These are expected unless a task asks to fix them:

- No server-side database.
- No login or permission model.
- Participant URLs are not secure.
- Cross-device realtime sync is not implemented. The share UI now states this limitation explicitly.
- Draw result input is incomplete.
- Standings follow the official DM tiebreak order: match points → OMW% → defeated opponents' total match points → opponents' average OMW%. GW%-style tiebreakers are not part of the official order and are not used.
- Tests are not yet present.

Resolved since the last revision:

- QR codes are now real, scannable QR codes generated by `lib/qr.ts` (dependency-free ISO/IEC 18004 encoder, byte mode, ECC level M, versions 1-10).
- The shared round clock is persisted as `Round.endsAt`, so reloads and participant tabs derive the same remaining time.
- Tournament state can be restored from the results JSON backup via the admin export panel.

## Multi-Agent Team Model

When using multiple Codex agents from the desktop app, split work by ownership. Keep changes scoped so agents do not overwrite each other.

Recommended roles:

### Lead / Integrator

- Owns task breakdown, final decisions, and merge order.
- Checks `git status` before and after each agent's work.
- Resolves conflicts and keeps `README.md` / `AGENTS.md` up to date.
- Runs final verification.
- Keeps implementation decisions aligned with `dm_competition_rule_20250501.pdf`.

### Domain Logic Agent

- Owns Swiss pairing, standings, tiebreakers, elimination, BYE handling, and judge-result effects.
- Should focus on pure functions and predictable state transitions.
- Should add or propose tests when changing tournament rules.
- Must consult `dm_competition_rule_20250501.pdf` before changing official-rule behavior.
- Should separate rule-derived calculations into testable functions before adding complexity.

### Admin UX Agent

- Owns admin setup, operations console, match controls, timers, and judge workflows.
- Must keep the interface compact and operational.
- Should verify desktop and tablet-width layouts.
- Should design workflows around real event staff needs: quick correction, clear status, low ambiguity, and visible audit context.

### Participant UX Agent

- Owns participant view, mobile ergonomics, match display, result reporting, reload/sync affordances, and QR/join flows.
- Should verify small mobile widths.

### Persistence / Sync Agent

- Owns `localStorage` compatibility now, and future DB/API/realtime work if introduced.
- Must preserve migration behavior through `normalizeTournament`.
- Should document any state shape changes.

### QA / Review Agent

- Reviews for regressions, edge cases, accessibility, responsive issues, and missing verification.
- Prioritizes concrete bugs with file and line references.
- Runs or requests build/lint/tests before final handoff.
- Checks that rule-driven behavior matches the PDF or is explicitly marked as provisional.

### End-User Tester Agent

- Tests the app as a non-engineer who has not read the implementation.
- Focuses on whether the UI is easy to understand, easy to operate, and ready to use during a real event.
- Uses beginner assumptions: the tester may not know the internal data model, localStorage, React, or Swiss pairing implementation details.
- Tests both staff and participant perspectives.
- Looks for confusing labels, unclear next actions, hidden state, crowded screens, unreadable text, accidental destructive actions, and flows that require explanation.
- Verifies that a first-time organizer can create an event, start a round, record results, handle a judge call, and move to the next round without reading documentation.
- Verifies that a participant can open their screen on a phone, identify their table/opponent, report a result, and understand their current standing.
- Reports findings as user-facing friction, not implementation advice. Example: "I do not know whether this button starts a new round or restarts the current round."
- Includes the viewport/device used, the attempted task, what was expected, what happened, and the severity.
- Should not judge rule correctness unless the UI makes the rule outcome confusing to a user.

### Tournament Simulation Agent

- Stress-tests complete tournaments with generated participants.
- Runs seeded scenarios for 32, 64, 128, and 256 participants.
- Verifies that setup, pairing, result entry, round advancement, standings, drops, penalties, BYEs, and final results continue to work at scale.
- Uses deterministic sample data where possible so failures can be reproduced.
- Checks both performance and operational clarity: the app should remain responsive, readable, and manageable as table count grows.
- Exercises normal results, judge-entered double losses, drops after reported matches, fixed-table players, and lucky prize eligibility when those features exist.
- Reports the participant count, number of rounds played, generated edge cases, failures, performance notes, and screenshots or reproduction steps when available.
- Should distinguish rule failures from usability failures and data-volume/performance failures.

## Multi-Agent Workflow

1. Lead defines a small task contract for each agent, including files they should touch.
2. Each agent starts by reading `AGENTS.md`, `README.md`, and the files in their task area.
3. Each agent checks `git status --short --branch` before editing.
4. Agents avoid broad refactors while another agent is working nearby.
5. Agents report changed files, verification run, and remaining risks.
6. End-User Tester Agent runs beginner-oriented smoke tests on flows that changed.
7. Tournament Simulation Agent runs scale scenarios when tournament logic, persistence, or table UI changes.
8. Lead integrates one change at a time and reruns verification.

Avoid concurrent edits to `app/page.tsx` when possible because it currently contains most of the app. If multiple agents must work there, split by function/component ranges and coordinate carefully.

## Coding Guidelines

- Prefer small, readable TypeScript changes.
- Keep domain helpers deterministic where possible.
- Do not introduce new state libraries until complexity justifies it.
- Do not add large dependencies for simple UI behavior.
- Use stable IDs and preserve existing event codes/player IDs unless the task requires changing them.
- Keep comments rare and useful.
- Preserve TypeScript strictness.
- Avoid unrelated formatting churn.

## UI Guidelines

- Use the existing dark operational visual system unless the task is a redesign.
- Keep cards/panels at 8px radius or less.
- Ensure long player names and URLs do not overflow.
- Check mobile layout when touching participant view or shared components.
- Do not add explanatory marketing text inside the app.
- Prefer controls that match the action: buttons for commands, selects for choices, inputs for numeric values, checkboxes/toggles for binary settings.

## Testing And Verification

Minimum verification after code changes:

```bash
npm run build
```

Also run lint when practical:

```bash
npm run lint
```

Manual flows to check after relevant changes:

- Create tournament from pasted names.
- Start round 1.
- Report all matches.
- Advance to next round.
- Confirm standings update.
- Confirm repeated pairing avoidance still works when possible.
- Confirm participant view loads from `?view=participant&event=...&player=...`.
- Confirm `localStorage` reload keeps the event.
- Confirm mobile layout does not overlap controls.
- As a first-time organizer, identify the next required action without reading docs.
- As a participant on mobile, identify table, opponent, timer, and report button within a few seconds.
- As staff, recover from a mistaken result or judge action without losing track of what changed.
- Simulate 32, 64, 128, and 256 participant events through completion when pairing, standings, persistence, result handling, or final export changes.

For domain-rule changes, add tests if a test harness exists. If no harness exists, propose or create a small testable module before expanding logic.

## End-User Test Script

Use this script when the goal is GUI polish, onboarding, readability, or operational readiness.

Tester persona:

- Not an engineer.
- Understands the idea of a tournament, but does not know how this app is built.
- May be a store staff member running an event under time pressure.
- May be a participant using a phone in a noisy venue.

Staff smoke test:

1. Open the app for the first time.
2. Create an event with 8 pasted participant names.
3. Find and copy/share the participant URL.
4. Start round 1.
5. Read the pairings and timer.
6. Enter one normal result.
7. Record one judge action.
8. Correct a mistaken score.
9. Finish the round and advance.
10. Explain what the current standings mean.

Participant smoke test:

1. Open a participant URL on a mobile viewport.
2. Confirm player ID and name.
3. Find table and opponent.
4. Report a match result.
5. Reload and confirm the reported state is understandable.
6. Check current standings and past round history.

Report format:

```text
Persona:
Viewport:
Task:
Severity: blocker | high | medium | low
What I tried:
What confused me:
What I expected:
Suggested wording or UI direction:
```

## Tournament Simulation Script

Use this script for scale and end-to-end tournament confidence.

Command:

```bash
npm run simulate
```

Participant counts:

- 32 players
- 64 players
- 128 players
- 256 players

Scenario expectations:

- Generate deterministic participant names such as `Player 001`.
- Use official recommended Swiss round counts when available.
- Start the event, generate pairings, report every match, and advance until the configured completion condition.
- Include at least one run with normal results only.
- Include at least one run with edge cases once supported: BYE, double loss, drop after reported match, fixed table, disqualification, and lucky prize drawing.
- Reload or restore saved state between at least two rounds to verify persistence.
- Confirm final standings contain all expected active players and exclude disqualified/removed players according to rules.
- Confirm final export contains standings, round results, and tiebreaker values once export exists.

Report format:

```text
Participant count:
Round count:
Scenario seed:
Completion state:
Failures:
Performance notes:
Usability notes:
Data integrity notes:
```

## Git And Secrets

- Never commit tokens, PATs, temporary clone tokens, `.env` files, or local credentials.
- Keep `origin` token-free:

```bash
git remote -v
```

Expected remote shape:

```text
https://github.com/hirosej_hasbro/swiss-draw.git
```

- Do not rewrite user changes.
- Do not run destructive git commands unless the user explicitly asks.

## Good First Improvements

- Split domain logic out of `app/page.tsx` into testable modules.
- Add unit tests for standings and pairing.
- Extract rule requirements from `dm_competition_rule_20250501.pdf` into a concise developer reference.
- Implement draw input and time-limit result handling.
- Add detailed tiebreakers: OMW%, GW%, OGW%.
- Improve participant mobile UX.
- Add participant self-registration, ID lookup, deck image registration, and drop request flows.
- Add staff tools for fixed table assignment, double-loss handling, lucky prize drawing, final result export, and round-by-round save snapshots.
- Add playoff/top-cut support after Swiss rounds, including Swiss finals or single elimination with optional third-place match.
- Add export for tournament results.
- Plan server persistence and auth only when moving beyond local prototype.

## Rule-Driven Roadmap

For the next phase, prefer this order:

1. Extract the official tournament concepts from `dm_competition_rule_20250501.pdf`.
2. Move standings, pairings, penalties, and tiebreakers into testable domain modules.
3. Add tests for Swiss pairing, BYE assignment, opponent calculations, penalties, drops, and final standings.
4. Update admin workflows so staff can apply judge decisions quickly and see their effect immediately.
5. Update participant workflows so reports are simple, clear, and resilient to mistakes.
6. Add persistence/realtime/auth only after the local rule model is reliable.
