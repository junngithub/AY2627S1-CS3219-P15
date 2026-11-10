# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-01
# Scope: Documentation wording for load-test evidence notes under author-fixed analysis.
# Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

# Grafana interpretation — `full-1520`

Snapshot: k6 Prometheus (Native Histograms), test id **`full-1520`**.  
Companion k6 log: `full-1520.txt`.

**Time range note:** The Grafana window (~15:12–16:01, about **49 minutes**) is wider than the **~15 minute** k6 scenario. Extra time is idle before/after, UI refresh, and cool-down after VUs hit zero. That wide window is also why some **stat tiles** look idle (they often show a **last** value from after the rush).

This pass was measured against a **peak-sized deployment** (Order pinned at **32** replicas, create-path peers pinned warm, short-lived larger RDS for the run, supplier/telegram caches). Results below assume that footprint — not the scaled-down idle dev layout.

---

## What “failure” means here

k6 marks an HTTP request **failed** when it does not get an **expected** success (for example status 201 on create, or 200/409 on accept). Common causes under load:

- Client **timeout at 30 seconds** (`status=0` in k6 — no usable HTTP response in time)
- **5xx** from a service or mesh
- Connection errors / resets

So “failure” here means **that attempt did not complete as expected**. It does **not** by itself prove a crash, OOMKill, or permanent outage. We did **not** attach pod-restart / OOMKill evidence to this note; treat “no crash” as **plausible from thresholds passing**, not as proven.

Accept **409** (order already taken) is treated as success for fulfill, not as a failure.

### Create timeouts and data (important)

A create that **fails on the client at 30s** may still have **succeeded on the server** (order row written, credit reserved) while the user saw an error. A retry could then create a **second** order unless create is idempotent.

This write-up does **not** claim “no data was lost” or “no duplicate creates.” Resolving that needs a DB check: compare Order rows (and credit reservations) created in the window against k6’s **~7.1k** successful creates (`7129` in `full-1520.txt`). That check was not done for this document.

---

## What the dashboard is showing

The run ramps virtual users up toward **9600**, holds briefly at full load, then cools down. That matches the peak profile in `load.js`. The scenario is ~**15 minutes**, but the **9600 VU plateau is only ~3.5 minutes** (CSV: ~15:27:30–15:31:00) — so do not call full load “sustained” for the whole run.

During the busy part of the chart you should see:

- **VUs** climb to **9600**, hold ~**3.5 minutes**, then fall
- **Request rate** about **0.7–0.9k req/s** in that hold (see RPS table below)
- **Latency** (p99) get worse while everyone is online — into **many seconds**, not milliseconds
- **Error series** stay thin relative to total traffic when thresholds pass

After cool-down, traffic and latency look “fine” again because almost nobody is left.

### Evidence from exported CSVs (`grafana logs/`)

| Metric | From CSV | Notes |
| --- | --- | --- |
| VU hold | **9600** for ~**3.5 min** (~15:27:30–15:31:00) | `Performance Overview` (vus series) — not the full 15-minute scenario |
| RPS in VU hold | about **0.7–0.9k req/s** (hold max **~934**) | `Peak RPS` / `HTTP Request Rate` — the full-load figure |
| Peak RPS | **~1.56k req/s** at 15:32:00 | Max while VUs were already falling — **not** hold intensity |
| k6 run average RPS | **~670 req/s** | `full-1520.txt` (`http_reqs` rate) — whole scenario |
| p99 duration in hold | about **15–19s** (hold avg ~**17.8s**, max **19.0s** at 9600 VUs; **19.2s** as cool-down starts) | `HTTP Request Duration` |
| p99 duration at end | **5.49 ms** at 15:38:00 | Same file — **last** sample after cool-down; matches the misleading Duration tile |
| Grafana request total | **588745** | `HTTP requests` (last counter); ÷ ~670 req/s ≈ **~880s ≈ 14.6 min**, matching the ~15-minute scenario |
| Blocked p99 | mostly **µs**; brief **~1.08s** at 15:27:30–15:28:30 | Rules out k6 connection pooling as the main latency cause. Export is **blocked only** — waiting/TLS/etc. not in this CSV |

**Cite:** **~670 req/s** average, **~0.7–0.9k req/s** during the ~3.5-minute full-load hold, **~15–19s p99** under load — **not** 5.49 ms, and **not** 1.56k as hold throughput.

**Hypothesis (cool-down RPS spike):** the **~1.56k** peak at 15:32 is while VUs are falling. Likely causes are the script’s **close-drain** phase firing a burst of close/ack traffic, and/or **queued requests** from the hold finally completing — not evidence that the system held 1.5k req/s at 9600 VUs.

---

## How to read the main numbers

### Virtual users (VUs)

How many fake users k6 was running at once. Peak ≈ **9600**, but only for ~**3.5 minutes** of the ~15-minute scenario. This is the load we chose (~2× expected peak headcount), not “all of NUS online.”

### Request rate (RPS)

How many HTTP calls per second hit Order.

| Figure | Source | Use for |
| --- | --- | --- |
| **~670 req/s** | k6 `http_reqs` rate over the full scenario | Citable average for the run |
| **~0.7–0.9k req/s** | Grafana during the ~3.5-minute 9600 VU hold | Full-load intensity |
| **~1.56k req/s** | Grafana max (15:32) | Cool-down spike only — see hypothesis above |

Flat RPS while VUs still climb would mean the system (or the generator) could not take more work.

### Request duration (latency)

Time from sending a request until the response finishes.

- Under **peak load**, k6 reports average ~**5.3s**, p95 ~**14s**. Grafana **p99** during the VU hold is about **15–19s** (CSV).
- The Duration **stat tile ~5.49 ms** is the **last** CSV point after cool-down — not the hold.
- That fits **queueing under load**: workers, database, and peer services shared by thousands of callers.

### Failed requests

Use **`full-1520.txt`** for failure counts and rates (not Grafana failure panels). For this run:

| Phase | Fail rate | Notes |
| --- | --- | --- |
| Create | **4.32%** | Tightest; little headroom under the 5% bar |
| Read | **2.59%** | Most of the traffic |
| Fulfill | **1.54%** | Accept / collect / deliver |
| Close | **1.77%** | Acknowledge / escalate |
| Overall | **2.45%** (`http_req_failed`: **14823** / **603771**) | All under the **5%** threshold |

**Why 5%?** It is **our chosen** pass bar for this course load test (survival under peak), not an industry SLA. Roughly **1 in 23 creates** failing that bar is intentional tolerance for overload — acceptable for “won’t fall over,” not for a production UX promise. Create at **4.32%** shows we passed, but barely on that phase.

### Checks

Assertions in the script (e.g. “order created”, “read ok”). In `full-1520.txt`, **checks_succeeded** is **97.54%** (588948 / 603771). A check can fail even when HTTP returns something, if the assertion is not met.

---

## Stat tiles that look misleading

Grafana shows big summary tiles such as **Peak RPS** and **HTTP Request Duration** with tiny values (e.g. a few req/s, or **~5 ms**).

Those tiles often take a **single reduced value** from the whole time range — commonly something like the **last** point, after the test has wound down (and after the extra idle time in a ~49 minute snapshot). So:

- **~5 ms duration** ≈ “how fast was it when almost nobody was left?”
- **Not** “what was p99 in the middle of lunch peak?”

For “how slow under load?”, use:

1. The **Performance Overview** graph while VUs are high, and/or  
2. The **k6 summary** in `full-1520.txt` (avg / p95 duration).

Do not cite the millisecond Duration tile as the peak result.

Prefer **`full-1520.txt`** for exact pass/fail rates; ignore Grafana failure counters for citation.

---

## Latency breakdown panels (plain English)

| Name | Meaning |
| --- | --- |
| Blocked | Waiting for a free connection **inside k6**. If this stays high, the **load generator** is limiting you |
| TLS | Handshake (usually small once warm) |
| Sending | Writing the request |
| Waiting | Waiting for the server to start responding |
| Receiving | Reading the response body |
| Duration | Whole request |

**From the exported Blocked CSV:** p99 blocked is almost always **microseconds** through the run, with a short bump to **~1.08s** right as VUs first hit 9600. So k6 connection pooling does **not** explain the multi-second total duration for most of the hold.

**Still a hypothesis:** that **waiting** makes up most of **duration** (backend-bound). The Timings CSV export only included the blocked series, so waiting/TLS/sending/receiving were not verified from files here. Re-export those series from Grafana if you need to state that as fact.

---

## Requests by URL

Breaks latency down by endpoint name (`create`, `pool`, `accept`, and so on). Useful to see which calls hurt most in the tail (p95/p99). Create is expected to be among the slower ones.

---

## Bottom line

For **`full-1520`**, with a **peak-sized deployment**, Grafana CSVs and k6 agree: a ramp to 9600 users produced about **~670 req/s** on average and about **0.7–0.9k req/s during a ~3.5-minute full-load hold** (Grafana’s **~1.56k** max is a cool-down spike, not hold throughput); p99 duration in that hold was about **15–19s** (not the **5.49 ms** cool-down tile); fail rates are those in **`full-1520.txt`** (overall **2.45%**, create **4.32%**), under the **5%** bar with little headroom on create. The evidence covers a short full-load window inside a ~15-minute scenario. The test supports **survival under a NUS-skewed peak**, not millisecond UX and not a full proof of create idempotency or zero pod restarts.

---

## Artefacts

| File / link | Role |
| --- | --- |
| `full-1520.txt` | Official thresholds and timings |
| `grafana logs/*.csv` | Panel time series used for the numbers above |
| Grafana snapshot of this run | Visual VUs / RPS / latency over time |
| Dashboard JSON export | Layout only — **does not** store the metric points |

---

## Capacity vs cost (why we did not push latency further)

Earlier runs showed that **giving services more resources** (more Order/peer pods, warmer floors, caches, larger RDS during the test) **improves** fail rates and makes the rush more survivable. That learning is real and carries to other environments.

For **this** run and this **dev** context, the goal was narrower: prove the system **won’t fall over at lunch** (stay under failure thresholds), **not** make every call as fast as an idle system or a fully funded prod fleet.

We sized enough to **pass survival thresholds** and to learn what knobs matter. We did **not** keep pushing scale only to shave seconds off p95/p99. Applying that peak-sized footprint to **dev long term** (always-on large RDS, many burst nodes, Order pinned at 32, and so on) is **not ideal** — it costs money without teaching much more. The pattern is: scale up for the full run, take the lessons, scale down after. Further latency tuning belongs where the budget and SLOs justify it — not as permanent default on shared non-prod.
