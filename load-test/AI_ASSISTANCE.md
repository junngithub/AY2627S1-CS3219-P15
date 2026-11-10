# AI Assistance Disclosure — Load-test Helm chart and seed scripts

**Tool:** Cursor (Auto)

**Scope:** Cursor Auto **assisted edits** to the Helm chart
(`Chart.yaml`, `values.yaml`, `templates/*`) and seed scripts
(`setup/roster.mjs`, `setup/seed-users.mjs`). Origin may be mixed:
**Varun Sivakumar** designed the load profile, seeding approach, and chart
layout; files may include author-originated content later edited with Auto.

The k6 scenario script `k6/load.js` carries its own in-file header.

**Author review:** Varun Sivakumar generated ideas, designed implementation,
validated correctness, edited where needed, and verified behavior/tests.

See also [`/ai/usage-log.md`](../ai/usage-log.md) and
[`/ai/plans/fix_order_loadtest.md`](../ai/plans/fix_order_loadtest.md).
