# ⚠ This is a FORK — read before answering anything about "latest Paperclip"

**You are not on upstream Paperclip.** This repository is a fork that carries a
small set of deliberate changes. If you are an agent (or a human) reasoning about
Paperclip's behaviour, upgrades, or "what does Paperclip do here?", the code in
front of you may not be upstream's code.

| | |
| --- | --- |
| `upstream` | `github.com/paperclipai/paperclip` — **the base. Source of truth for "what does upstream do?"** |
| `origin` | `github.com/michaltakac/paperclip` — this fork. `master` tracks upstream and carries **no** custom work. |
| Our branch | **`ordillect/prod`** — `master` + the commits below. The Ordillect production box builds from this. |

## The rule

- **Questions about upstream behaviour, new features, or whether a bug is fixed
  → check `upstream/master`, never this branch.** This branch intentionally
  diverges; reading it will tell you what *we* do, not what Paperclip does.
- **`master` here is a mirror, not our code.** Never commit to it. It exists only
  so `ordillect/prod` has something to rebase onto.
- **Before claiming "upstream doesn't do X"**, verify:
  `git fetch upstream && git show upstream/master:<path>`.

## Why each commit exists

Every commit is either a workaround for an upstream bug or a fix upstream has
not taken. Each is a candidate to send upstream as a PR — that is a feature of
this arrangement, not an afterthought.

| Commit | Kind | Why it exists | Drop it when… |
| --- | --- | --- | --- |
| `fix(plugin-registry)`: atomic `upsertEntity` | upstream bug | `SELECT`-then-`INSERT` is not atomic and races under the honcho plugin's parallel import → duplicate-key error fails the whole job | upstream adopts `ON CONFLICT DO UPDATE` (still absent at v2026.916.1) |
| `fix(plugin-job-scheduler)`: runJob timeout 15m | upstream bug | 5-minute default is shorter than a first-run bulk memory import; host gave up while the worker was still (successfully) importing | upstream raises the bound or makes it configurable (still 5 min at v2026.916.1) |
| `feat(plugin-host)`: `PAPERCLIP_SSRF_ALLOWED_IPS` | missing feature | Plugin fetches are blocked to all RFC1918 addresses; self-hosted Honcho lives on a private IP | upstream ships an equivalent escape hatch (none at v2026.916.1; upstream's `allowPrivateNetwork` covers other subsystems, not the plugin host) |
| `fix(health)`: omit `deploymentExposure` when anonymous | **disagreement** | Upstream *deliberately* added this field to the anonymous branch; it makes Paperclip Desktop's remote preflight classify the host as `not_paperclip`. **Upstream may never take this** — expect to carry it. | Desktop's preflight contract changes |
| `fix(tool-access)`: health-check plugin backfills by plugin state | upstream bug | Legacy plugin backfill connections carry `mcp_remote` with no URL. Upstream's sweep skips them (v2026.916.1), but a **manual** check still probes and fails with `requires config.url`. The app setup page then asks for a "new key" on a connection that has none. Ours reports the plugin's own `status` and makes no network probe. | upstream stops routing `paperclip_plugin` connections through the remote-MCP probe in `checkConnectionHealth` |

## Audit at v2026.916.1 (2026-09-23)

`v2026.824.1 → v2026.916.1`: 738 upstream commits, none dropped. The four code
commits were each checked against the tag's source: all still needed.

- Only `fix(health)` conflicted. Upstream added `localAiLoginSupported` and a
  dynamic `status` to the anonymous response. We kept both and still omit
  `deploymentExposure`.
- `v2026.824.1` was cut from a release branch, not from `master`. Every code fix it
  carried is in `v2026.916.1`. Only its release-notes file is not, and we dropped it.
- Added `fix(tool-access)` (above). Upstream's partial fix is the sweep's
  `ne(toolApplications.type, "paperclip_plugin")`. It stops new errors but does not
  clear an existing one, and it does not cover the manual check.

## Dropped because upstream fixed it (audit at v2026.824.1, 2026-08-25)

Three commits were retired during the `v2026.722.0 → v2026.824.1` rebase. Do not
resurrect them without re-reading upstream first.

| Dropped commit | Upstream's replacement | Why theirs is better |
| --- | --- | --- |
| `fix(plugin-worker-manager)`: empty context for scope-less callbacks | `referencedCompanyId()` + `proactiveCompanyScopes` in `contextForWorkerMessage` (LOOA-693/695) | Ours returned `{}` for **every** scope-less callback, weakening the gate globally. Upstream resolves the referenced `companyId` and admits it **only** if the plugin is configured for that company, keeping `invalidInvocationScope` for everything else. |
| `fix(ui/invite)`: post accept immediately | `shouldAutoAcceptHumanInvite` latched effect + `rememberPendingInviteToken` | Ours fired a second accept from `authMutation.onSuccess`. Upstream gates on a present session, latches with `autoAcceptStarted`, and persists the invite token so a **reload** resumes — closing the window our patch only narrowed. |
| `fix(runtime)`: honor explicit `PAPERCLIP_API_URL` (AGE-419) | `packages/adapter-utils/src/server-utils.ts` now resolves `PAPERCLIP_API_URL ?? PAPERCLIP_RUNTIME_API_URL ?? derived` | Upstream inverted the precedence at the only place it matters, with a comment naming our exact case (public base URL that is VPN/tailnet-only). Ours overwrote `PAPERCLIP_RUNTIME_API_URL` globally, which upstream now wants to stay the public origin. |

## Updating (the only supported flow)

```bash
# 1. sync the fork's master with upstream — master is a pure mirror
gh repo sync michaltakac/paperclip -b master
git fetch upstream master && git fetch origin master

# 2. rebase our branch onto the new base
git checkout ordillect/prod
git rebase master

# 3. resolve, then force-push (rebase rewrites history — expected here)
git push --force-with-lease origin ordillect/prod
```

**A rebase conflict is good news.** It means upstream changed code we patch —
usually because they fixed the bug themselves. Read their version first: if it
fixes the problem, **drop our commit** rather than reapplying it. Shrinking this
branch is the goal.

After any rebase, re-verify the behaviour these commits protect — most cheaply
by running Paperclip's plugin tests and clicking **"Initialize Honcho memory"**,
which exercises the first four commits end to end.

## What is deliberately NOT here

- **`apply-patches.py`.** An earlier plan re-applied these fixes to
  `server/dist/*.js` at container start. That mechanism cannot carry the
  `ui/invite` fix (the UI ships as minified Vite bundles), and it fails quietly —
  the server boots with the feature broken. A rebase conflict stops the build
  instead. One mechanism, loud failure.
- **The `ordillect-brain-mirror` plugin.** Added and then deleted upstream of
  this branch; superseded by `@honcho-ai/paperclip-honcho` (first-party, and it
  ships a UI). Do not resurrect it.
