# HA Editor Chat

A sidebar AI chat that edits **this Home Assistant's configuration** by opening
**reviewed GitHub pull requests** — never by writing your live `/config`. CI
(`yamllint` + HA `check-config`) validates every change before you merge, and the
Pi's `core_git_pull` add-on deploys merged `main` as usual. Because the AI only
touches the git-managed YAML via PRs, its edits can't conflict with your UI/`.storage` changes.

## How it works

```
you type a request  →  add-on clones your config repo from GitHub  →  AI edits on a branch
   →  local yamllint gate  →  push  →  Pull Request  →  GitHub Actions (validate.yml)  →  you merge
```

## Options

| Option | Meaning |
|--------|---------|
| `repo_url` | Your HA config repo (the one `core_git_pull` deploys). Default: the mainklein repo. |
| `base_branch` | Base branch for PRs (default `main`). |
| `github_token` | A fine-grained PAT with **Contents: read/write** + **Pull requests: read/write** on that repo only. Used to push branches and open PRs. Stored on your device, never in the add-on repo. |
| `agent_mode` | `stub` (deterministic sample edit — for testing the pipeline) or `claude` (real Claude via our LiteLLM gateway). |
| `litellm_base_url` | The LiteLLM gateway root (default `https://api.agiliton.cloud/llm`; the client appends `/v1/messages`). |
| `litellm_key` | Your dedicated `mainklein-ha-editor` key (only needed for `agent_mode: claude`). |
| `model` | Gateway model alias (default `mainklein-editor`). |

## Safety

- The AI edits a **fresh clone**, not your live `/config`.
- It **cannot** edit `secrets.yaml` (SOPS) or `.storage` (denied in the pipeline).
- Nothing deploys until **you review and merge** the PR.
- A change that fails CI simply can't be merged.

## Notes

- Start with `agent_mode: stub` to confirm the PR/CI loop end-to-end, then switch to `claude`.
- The panel restricts to admin users and is reachable only through Home Assistant ingress.
