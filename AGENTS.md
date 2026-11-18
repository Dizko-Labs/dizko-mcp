## Git sync rule

These rules keep local checkouts and GitHub in sync across local and cloud sessions. Where this file describes a repo-specific workflow (landing, release, CI, merge gates), that workflow takes precedence.

Before changing files, inspect the working tree and current branch, then run git pull --ff-only on that branch when it has a configured upstream. If the worktree has unrelated changes, the branch is detached or has no upstream, or the pull fails or diverges, stop and report the state. Do not stash, reset, switch branches, force-pull, or overwrite work automatically. Re-read repository guidance after pulling. Pulling updates only this branch's upstream; it does not import another branch or unmerged PR.

After finishing a change, commit it and push so GitHub stays current — don't leave work only on one machine:
- If on the default branch, create a descriptive branch first; never commit or push to the default branch without asking unless this file's workflow says otherwise. Push the branch with an upstream (`git push -u origin <branch>`) and offer to open a PR.
- On a non-default branch with an upstream, commit and push to it directly.
- If the push is rejected because the remote moved, run `git pull --ff-only` and push again; if that fails, stop and report. Never force-push, rewrite pushed history, or delete remote branches without asking.
- Before ending a task, confirm `git status` is clean and nothing is unpushed; if anything is left behind, say so.

## Git security

- Stage files by name, not `git add -A` / `git add .`, and review `git diff --staged` before committing.
- Never commit secrets: `.env` files, API keys, tokens, private keys, credentials, or service-account JSON. If one is about to be committed, stop and warn; if one is already in history, report it rather than trying to scrub it.
- Don't change repo visibility, branch protection, collaborators, or org settings without asking.

## Working rules

These mirror the owner's global rules so cloud, Codex and factory sessions follow them too. Where this file describes a repo-specific workflow, that workflow takes precedence.

- Finish the whole job before you stop. Don't offer to continue: continue.
- Ask before you delete anything: files, directories, branches, data, records, or memories. Editing lines inside a file as part of the task, and removing scratch files created in the same session, do not count as deletion here.
- End with a recap for someone who saw none of the work: key points first, plain words.
- Research before building. Don't write an unfamiliar feature from scratch. Search GitHub for open-source projects, compare their approaches, then start. Say which approach was chosen and why in the recap.
- Score bugs before fixing them. Rate each bug from 1 to 10 on how often it would happen and from 1 to 10 on how bad it would be. If the two scores multiplied are below 5, or below a threshold this file sets, file it as an issue and leave the code alone. Do not design for rare or future cases nobody asked about.
- Make implicit state machines explicit. In the code being worked on, look for groups of booleans or nullable fields that together encode a status, status strings compared in many places, and multi-step flows whose order lives only in handlers. Choose the change that improves the user experience (UX), developer experience (DX), and agent experience (AX) together, without breaking existing behavior. If fixing one falls outside the task, report it instead of widening the change.
- Starting-over check. Before handing off a change, and whenever asked to clean up or refactor, ask: if you were starting over today with the same goal, what would you still need to keep? Report whatever fails that test as removal candidates; removing them follows the ask-before-deleting rule.
- Audits report first. When asked to audit CI or these instructions, give the report before changing anything. A CI audit splits each job's time into queue, setup and task; an instruction audit lists contradictions, outdated statements, misplaced items and duplicates as deletion candidates with reasons.
