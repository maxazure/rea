# Fork-only manual Windows preflight

This is an owner-operated check for `maxazure/rea`, not an upstream CI change or a full qualification receipt. It runs the reviewed Windows capability/package lane on `MAXFAST-windows-x64` through the labels `self-hosted`, `Windows`, `X64`, and `maxfast`.

## Run

1. Review the exact candidate source and dependency/install scripts. They execute with the runner account's existing permissions; this workflow is **not a sandbox**. Do not run an untrusted pull request on a persistent runner.
2. As `maxazure`, open **Actions → Manual Windows preflight (fork only) → Run workflow**. Select **main**, and enter the full lowercase 40-character commit SHA already present in this fork. The initially reviewed candidate is `221ed547c10f72a92df23903db2de87b448e0be5`.
3. Review both jobs. The final Windows report identifies the exact candidate, runner, OS, and each step outcome. A failed/skipped stage is not qualification. Download `windows-preflight-reports` for command logs and the capability report. The Linux result is in `windows-preflight-linux-report`.

Only manual dispatch from main by the owner (including the owner initiating reruns) is admitted. All runs share one concurrency group; an active run is not cancelled by a newer dispatch. GitHub may replace a pending run with a newer pending run. One Windows job runs at a time for this workflow. Other unrelated workflows are not controlled by this group.

## Coverage

The Linux job validates the input and exact checkout, checks the reviewed native/Windows job blocks for drift, and verifies all named test files before executing candidate scripts. It installs the ordinary MinGW cross compiler on a standard hosted Linux runner and builds three candidate-specific artifacts: native controls, inspection failure fixture, and process-boundary executable. The Windows job consumes only this run's artifacts and checks out the same immutable SHA.

The Windows lane preserves all reviewed candidate commands: `npm ci`, native artifact verification, `build:cached`, named capability report, all 39 curated tests, native process-boundary verification with the explicit EXE, inspection recovery, real Node Inspector, Windows package verification, three Node 24 path/identity controls, and four Node 22 controls. Node versions are 24.18.0 and 22.19.0. Ghidra-related tests in this list are workflow/contract tests; no external provider or Java/Ghidra installation is requested.

There is no shared npm/Turbo cache upload or download. A cold local build replaces upstream's build-cache handoff. All uploaded fixtures and reports expire after seven days; GitHub artifact storage remains subject to account quotas. Existing GitHub workflow logs follow the repository's own retention setting.

## Trust and prerequisites

The control workflow is read from trusted fork main. The candidate's workflow is inspected only as data; its shell commands are never extracted or dynamically executed. Candidate project code and npm lifecycle hooks intentionally execute as part of testing. The repository token has read-only contents permission, checkout credentials are not persisted, no repository secrets are referenced, and actions are pinned to immutable commits. These measures do not isolate the runner from candidate code or from other software on the host.

The runner must already have working Git, PowerShell 7+, and a sufficiently current GitHub Actions runner supporting the pinned actions. An early built-in Windows PowerShell check stops if Git or PowerShell 7 is absent. Do not grant administrator rights, change execution/security policies, alter service permissions, or add provider labels to make this lane pass. Report any such blocker for the owner's decision. Ordinary Node setup and locked npm dependency installation happen during the job.

Lane changes fail closed: hashes bind the reviewed `windows-curated` and `windows-native-build` job blocks, including test arguments. If upstream changes either block or the pinned Node version, review the new lane, update this workflow's explicit commands/test paths and hashes together, validate syntax/parity, then dispatch again. Even a comment-only change in those two blocks requires review. This avoids silently dropping tests when the candidate gate evolves.

## Bootstrap

Publish only the new workflow, this document, and the additional `maxfast` lint-label entry to fork main. Keep existing `ci.yml` and upstream pull requests unchanged. A control-only bootstrap commit may include `[skip ci]` to avoid automatic broad CI; `workflow_dispatch` is still explicit. Do not claim Windows verification until the dispatched run finishes successfully.
