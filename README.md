# AnisEval

**Regression testing for AI outputs.** Define rules every AI answer must follow, import outputs from any model, and get pass rates, flaky-case detection, and side-by-side comparison between prompt versions.

**Live demo:** _add your Netlify link here_

---

## Why

Traditional tests assume the same input gives the same output. AI features break that assumption:

- **Outputs vary** between runs, so exact-match assertions don't work.
- **"Correct" is a set of rules**, not a single string.
- **Prompt changes cause silent regressions**: fixing one behaviour quietly breaks another.

AnisEval applies familiar QA practice to this problem. Teams in the AI industry call this kind of testing **evals**.

## Features

- **Test suites and cases**: each case is an input plus the assertions its output must satisfy
- **11 assertion types**: contains / does not contain, contains any / none of, regex match / no match, min / max words, valid JSON, required JSON fields, JSON field equals
- **Pass rates instead of pass/fail**: every case runs multiple times and is classified **stable**, **flaky** or **failing**
- **Failure drill-down**: every output, every check, and the exact text that triggered a failure, highlighted
- **Run comparison**: baseline vs candidate, with improvements and **regressions** flagged
- **Import from any AI tool** as CSV or JSON; export suites and runs
- **Private by design**: runs entirely in the browser, and data never leaves your device
- **Installable PWA** that works offline

## Sample suite: ShopEase support bot

The app ships with a suite for a fictional e-commerce support chatbot, covering:

| Case | What it checks |
|---|---|
| Refund policy | States the 30-day policy, promises no specific amount |
| Order tracking | Asks for the order number, invents no delivery date |
| Angry customer | Shows empathy, never blames the customer, stays concise |
| Off-topic | Redirects to store topics, invents no weather data |
| Prompt injection | Never reveals its system instructions |
| Sensitive data | Never echoes a card number back, warns the user |
| Escalation (JSON) | Returns machine-readable JSON with `action: "escalate"` |
| Competitor | Makes no claims about competitor pricing |

Two runs are included. **Prompt v2** fixes v1's prompt-injection leak and several flaky cases, raising the pass rate from 83% to 90%. But it **regresses** on the JSON escalation case: the model started wrapping the JSON in friendly text and markdown fences, which would break any code parsing it. The compare view catches this immediately.

## Import format

CSV:

```csv
caseId,run,output
refund-policy,1,"Yes, you can return items within 30 days..."
refund-policy,2,"Our policy allows returns within 30 days..."
```

or JSON:

```json
[{ "caseId": "refund-policy", "run": 1, "output": "Yes, you can return..." }]
```

`run` is optional. Unknown case IDs are skipped with a warning. Download a ready-made template from the **Runs** tab.

## Project structure

```
index.html          app shell and styles
src/engine.js       assertion, scoring, comparison and import logic (pure functions, no DOM)
src/ui.js           routing, rendering and event handling
src/sample-data.js  ShopEase sample suite and prompt v1/v2 outputs
sw.js               offline caching
manifest.webmanifest, icons/   installable app metadata
```

**Design decisions**

- **Logic separated from UI.** `engine.js` has no DOM or storage access, so every assertion and scoring rule can be unit-tested in isolation.
- **No build step.** Plain ES modules, deployable to any static host.
- **Test hooks built in.** Key elements carry `data-testid` attributes for stable end-to-end selectors.
- **Deterministic assertions.** The same output always gets the same verdict, so the tool itself is never flaky.

## Run locally

Any static server works, for example:

```bash
npx serve .
```

## Roadmap

- [ ] Playwright test suite: unit tests for every assertion type, plus E2E tests for import, results and compare flows
- [ ] GitHub Actions CI: tests run on every push, and deploys are blocked on failure
- [ ] Live mode: call an AI API directly, with a small backend to keep the API key safe
- [ ] Semantic similarity and LLM-as-judge assertions for subjective criteria
