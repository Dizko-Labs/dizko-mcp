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
