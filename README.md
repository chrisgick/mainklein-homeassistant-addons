# Mainklein Add-ons

A Home Assistant add-on repository (CF-7293).

Add it in Home Assistant → **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
with this repo's URL, then install **HA Editor Chat**.

## Add-ons

- **[HA Editor Chat](./ha-editor/)** — sidebar AI chat that edits your HA config via reviewed GitHub PRs (never live `/config`). CI-gated; conflict-free by design.

> Secrets (GitHub token, LiteLLM key) are entered as add-on **options** on your device — never stored in this repo — so this repository is safe to keep public.
