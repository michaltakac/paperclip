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
| `fix(plugin-worker-manager)`: scope-less worker callbacks | upstream bug | Job callbacks (e.g. honcho `initialize-memory`) carry no invocation scope; upstream rejects them whenever an unrelated invocation is in flight → **intermittent** failures | upstream stops flagging scope-less callbacks |
| `fix(plugin-registry)`: atomic `upsertEntity` | upstream bug | `SELECT`-then-`INSERT` is not atomic and races under the honcho plugin's parallel import → duplicate-key error fails the whole job | upstream adopts `ON CONFLICT DO UPDATE` |
| `fix(plugin-job-scheduler)`: runJob timeout 15m | upstream bug | 5-minute default is shorter than a first-run bulk memory import; host gave up while the worker was still (successfully) importing | upstream raises the bound or makes it configurable |
| `feat(plugin-host)`: `PAPERCLIP_SSRF_ALLOWED_IPS` | missing feature | Plugin fetches are blocked to all RFC1918 addresses; self-hosted Honcho lives on a private IP | upstream ships an equivalent escape hatch |
| `fix(ui/invite)`: post accept immediately | upstream bug | `company_join` human invites relied on a post-invalidation effect; a reload before it fired left **no join request server-side** (broke a real onboarding) | upstream fixes `InviteLanding.tsx` |
| `fix(health)`: omit `deploymentExposure` when anonymous | **disagreement** | Upstream *deliberately* added this field to the anonymous branch; it makes Paperclip Desktop's remote preflight classify the host as `not_paperclip`. **Upstream may never take this** — expect to carry it. | Desktop's preflight contract changes |

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
