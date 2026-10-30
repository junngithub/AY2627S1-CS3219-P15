# Dev deployment guide

Day-to-day operation of the **dev** env on AWS, plus what we learned bringing
it up (2026-10-21/22). First-time bring-up, step by step, is in
[`cloud-dev.md`](cloud-dev.md); the design is in
[ADR-0013](adr/0013-cloudfront-vpc-origin-and-external-secrets.md).

| | |
|---|---|
| App | https://djj7vqja8at5u.cloudfront.net |
| AWS account / profile | `474265880628` / `cs3219-dev` (NUS, SSO) |
| Region | `ap-southeast-1` |
| Cluster / namespace | `foc-nonprod` / `foc-dev` |
| State bucket | `foc-tfstate-474265880628` |

## 1. Quick guide

### Every new terminal

```bash
cd ~/Desktop/NUS/Y3S1/AY2627S1-CS3219-P15
export AWS_PROFILE=cs3219-dev     # `aws sso login` if it says the session expired
unset KUBECONFIG                  # plain kubectl = AWS; KUBECONFIG=infra/local/kubeconfig = Floci
kubectl config current-context    # …:cluster/foc-nonprod
```

Keep one terminal for AWS and one for local. `KUBECONFIG` set to the local
file is the most common way to end up talking to the wrong cluster (section 3).

### Common actions

| I want to… | Run | Then |
|---|---|---|
| Deploy a **service** code change | commit it, then `deploy/push-dev.sh <svc>` | `git push`, merge to `main`, **Refresh** in Argo CD |
| Deploy **every** changed service | `deploy/push-dev.sh` | same |
| Publish the **frontend** | `deploy/push-frontend-dev.sh` | nothing: live in 1–2 min (no merge) |
| Change **config** (env vars, replicas, quota, mesh) | edit `deploy/values/...`, commit | push, merge to `main`, Refresh |
| Change **AWS resources** | edit `infra/nonprod/aws`, then the apply below | commit the `.tf` |
| Let a tester sign up | SES console → Identities → Create identity → their email | they click the link |
| Unblock Telegram (no bot yet) | `deploy/dev-verify-telegram.sh <email>` | refresh the app |
| Make the first admin | `kubectl -n foc-dev exec deploy/user -c user -- node dist/bootstrap-admin.js --user-id <id> --confirm` | sign in again |
| Seed suppliers (**wipes them first**) | `deploy/seed-supplier.sh dev` | type `dev` to confirm |
| **Pause dev** (remove EKS, ~$100/month of ~$140) | `deploy/eks-down.sh` | type `down`; ~15 min |
| **Resume dev** | `deploy/eks-up.sh` | ~25 min; same URL, IDs and RDS data, nothing to commit |
| Query RDS from your laptop (psql / DBeaver) | `deploy/db-relay-dev.sh [admin\|<svc>] [database]` | connect to 127.0.0.1:15433, `sslmode=require`; Ctrl-C closes |
| Add the Gemini key | paste into Secrets Manager `foc/dev/admin-ai` | wait ≤1 h (or restart admin) |
| Turn on the Telegram bot | paste `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` into Secrets Manager `foc/dev/user-telegram` | `kubectl -n foc-dev annotate externalsecret user-telegram force-sync=$(date +%s) --overwrite` (or wait ≤1 h), then `kubectl -n foc-dev rollout restart deploy/user` |
| Open Argo CD | `kubectl -n argocd port-forward svc/argocd-server 8081:80` | http://localhost:8081, user `admin` |
| Argo CD password | `kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' \| base64 -d` | |
| Pods / logs | `kubectl -n foc-dev get pods` · `kubectl -n foc-dev logs deploy/<svc> -c <svc>` | |
| Restart a service | `kubectl -n foc-dev rollout restart deploy/<svc>` | |

Terraform for `infra/nonprod/aws` (`init` only once per machine):

```bash
terraform -chdir=infra/nonprod/aws init -backend-config="bucket=foc-tfstate-474265880628"
terraform -chdir=infra/nonprod/aws apply \
  -var state_bucket=foc-tfstate-474265880628 \
  -var ses_from_email=donleehh420@gmail.com
```

Read the plan before typing `yes`. A `-/+` (replace) on the node group,
RDS or CloudFront deserves a second look.

### Pausing dev (`eks-down.sh` / `eks-up.sh`)

`var.eks_enabled = false` in `infra/nonprod/aws` removes only the EKS cluster,
its nodes and add-ons. Everything else keeps its ID, so nothing in git changes:

| Kept (still billed, ~$40/month) | Lost (rebuilt by `eks-up.sh`) |
|---|---|
| RDS **and its data** (users, orders, credits, suppliers) | Kafka messages and consumer offsets (its disk is deleted) |
| Secrets Manager values (same passwords) | Argo CD's state and password (new `argocd-initial-admin-secret`) |
| NLB, CloudFront (same URL), S3 buckets, ECR images | Linkerd certificates (new trust anchor) |

- **Save more:** stop RDS too with
  `aws rds stop-db-instance --db-instance-identifier foc-nonprod`. AWS
  restarts it after 7 days; `eks-up.sh` starts it if it's stopped.
- **Don't** use `terraform destroy -target=aws_eks_cluster…`: it also destroys
  everything that references the cluster. RDS's security group used to, which
  is why it now allows the private subnets instead.
- `eks-down.sh` deletes Kafka's EBS volume (made by the EBS CSI driver, not
  Terraform) and the stale kubectl context.
- A plain `terraform apply` brings the cluster back (`eks_enabled` defaults to
  true). Use `eks-up.sh`, which also installs Argo CD and remeshes the pods.

### Argo CD buttons

| Button | Does |
|---|---|
| **Refresh** | Re-reads `main` now instead of in ~3 min; auto-sync then deploys. Use it after every merge. |
| **Sync** | Applies git and reruns hooks (e.g. a migrate Job). Rarely needed: auto-sync and self-heal are on. |
| **Hard refresh** | Refresh plus clearing the chart cache, when a values change doesn't show up. |
| **Delete** | Deletes the app **and everything it deployed**. Don't. |

`Synced` + `Degraded` usually means a rollout is stuck, not a git problem:
look at the Deployment's events, and `rollout restart` once the cause is fixed.

## 2. Important components

### How a request flows

```
browser ─HTTPS─▶ CloudFront ─┬─ /*      ─▶ S3 (frontend bucket, private, OAC)
                             └─ /api/*  ─▶ VPC origin ─▶ internal NLB :80
                                            ─▶ Envoy pods :10080 (TargetGroupBinding)
                                            ─▶ auth via user /internal/authorize
                                            ─▶ service pod (Linkerd mTLS) ─▶ RDS / Kafka
```

### Who owns what

| Piece | Lives in | Deployed by |
|---|---|---|
| VPC, EKS, RDS, NLB, CloudFront, S3, SES, Secrets Manager, IAM | `infra/nonprod/aws` | `terraform apply` (you) |
| Argo CD + root app | `infra/nonprod/bootstrap` | `terraform apply` (once) |
| Everything in the cluster | `deploy/argocd/nonprod.yaml`, `deploy/charts`, `deploy/values` | Argo CD, from **`main` only** |
| Service images | ECR `foc/<svc>-service:<git sha>` | `deploy/push-dev.sh` (laptop) |
| Frontend files | S3 `foc-dev-frontend-474265880628` | `deploy/push-frontend-dev.sh` (laptop) |
| Real IDs in values (registry, RDS host, ARNs) | `TF:` placeholders | `deploy/cloud-values.sh nonprod` (once per rebuild) |

### Data and secrets

- **Databases are on RDS** (`foc-nonprod`, Postgres 16), not in Kubernetes.
  One database and login per service: `dev_user`, `dev_credit`, `dev_order`,
  `dev_supplier`, `dev_admin`. Each service may only use its own.
- **Secrets** are generated by Terraform (`random_password`) into Secrets
  Manager as `foc/dev/<name>`. External Secrets copies them into Kubernetes
  Secrets of the same name, and pods read those. The `foc-database-setup` Job
  creates each RDS login with the password from the same Secret. RDS keeps its
  own admin password (`rds!db-…`).
- **Kafka** (Strimzi) runs inside `foc-dev`. Its entity operator creates one
  Secret per KafkaUser (`user`, `credit`, `order`, `rating`, `admin`); services
  that use Kafka can't start without theirs.
- **TLS to RDS**: Node services trust the RDS CA through ConfigMap `rds-ca`
  (`deploy/charts/cluster-config/files/*.pem`) and `NODE_EXTRA_CA_CERTS`.
  Node reads it **only at startup**.

### The NUS account rules (why things are unusual)

The NUS organisation denies `AssumeRoleForPodIdentity`,
`AssumeRoleWithWebIdentity`, role chaining and `iam:CreateUser`. So:

- **Pods use the node role** (`foc-nonprod-node`, policy `foc-workloads`) for
  SES, S3 photos, Secrets Manager and load-balancer targets. Every pod shares
  those permissions; each is limited to its resources.
- **GitHub Actions can't reach AWS**: no OIDC and no access keys. Images and
  the frontend are pushed from a laptop with the scripts above;
  `deploy-dev.yml` and `frontend-dev.yml` are manual-only. `ci.yml` (tests)
  still runs on PRs.

### Email (SES)

- Sender: `donleehh420@gmail.com`. Not `u.nus.edu`: its DMARC policy is
  `p=reject`, so NUS refuses mail SES sends "from" it.
- Gmail is `p=none`: delivered, often to **Junk**. A domain we own, with DKIM
  in SES, would fix that.
- The account is in the **SES sandbox**: every recipient must be a verified
  identity, at most 200 emails a day. Request production access to lift both.

### Sizing

- 2 × `t4g.large` Spot (arm64): one node fits only 29 pods (one VPC IP each),
  and a steady dev runs ~39.
- `foc-dev` quota: `limits.cpu: 12`. The steady state needs ~7.4 (7 services,
  their Linkerd proxies, Kafka broker and entity operator); the rest covers
  migrate Jobs and rollouts.

## 3. Mistakes and lessons

What went wrong during bring-up, why, and what fixed it. Look here first when
something similar happens.

### AWS and Terraform

| Symptom | Cause | Fix / lesson |
|---|---|---|
| `backend "s3"`: *value cannot be empty* | `bucket=$B` with `$B` unset (it only lives in the terminal that set it) | Pass the bucket name literally, or `B=$(terraform -chdir=infra/state output -raw bucket)` |
| EBS CSI add-on stuck `CREATING`; `AssumeRoleForPodIdentity … explicit deny` | NUS policy blocks Pod Identity, IRSA and OIDC | All pod permissions moved to the node role; IMDS hop limit 2 so pods can reach it (ADR-0013 amendment) |
| CI can't log in to AWS | Same policy (OIDC denied, no IAM users) | Laptop scripts; workflows manual-only |
| Pods `Pending`, `Too many pods` | One `t4g.large` = 29 pod IPs; dev needs ~39 | 2 nodes |
| `frontend_url` output missing | An earlier edit silently didn't apply | After scripted edits, check the result (`grep`), not just "no error" |
| `cloud-values.sh` put JSON into a header comment | Its pattern matched the bare `TF:` in `TF:<output>` | Pattern needs ≥1 character after `TF:` |
| Real account ID, RDS host and email now in a public repo | `cloud-values.sh` ran before the commit | Not secrets, but visible to anyone; decide before running it |

### Kubernetes and Argo CD

| Symptom | Cause | Fix / lesson |
|---|---|---|
| Plain `kubectl` showed EKS nodes in the *local* kubeconfig | `aws eks update-kubeconfig` ran with `KUBECONFIG=infra/local/kubeconfig`, merged EKS into it and made it current. `local.sh` would have deployed to AWS. | EKS context moved to `~/.kube/config`. Run `update-kubeconfig` only with `KUBECONFIG` unset |
| Strimzi reconciling a namespace that doesn't exist | It watched `foc-stg`, which isn't built | Watch `foc-dev` only (stg is commented out everywhere) |
| credit/user/order/rating `CreateContainerConfigError: secret "credit" not found` | Quota `limits.cpu: 6` refused the Kafka entity operator, so no KafkaUser Secrets were made | Quota 12. Check `kubectl get events` for `exceeded quota` |
| Apps `Synced` but `Degraded` after the quota fix | Rollouts had hit `ProgressDeadlineExceeded` and stay that way | `kubectl rollout restart` the affected Deployments |
| `dev-gateway` `Degraded`: `service foc-dev/admin not found` | admin never deployed (its migrate hook failed) | Fix admin; the gateway follows |
| Pushed a fix but the old code still ran | The commit wasn't built: the image tag in the values didn't change | Code fixes need `push-dev.sh` + merge; Argo CD only reacts to tag changes |

### Application

| Symptom | Cause | Fix / lesson |
|---|---|---|
| admin migrate Job: `permission denied to create role` | Migration 0003 creates a role; service logins can't (by design) | Create the role only if allowed; the triggers enforce append-only anyway |
| OTP email: `550 5.7.509 … DMARC policy of reject` | Sender `@u.nus.edu`, a domain we can't sign for | Gmail sender; a real fix needs our own domain + DKIM |
| `SES … AccessDeniedException` | Sandbox: SES checks permission on the recipient identity too; the role only allowed the sender | `identity/*` with an `ses:FromAddress` condition |
| Your NUS address stopped receiving | Replacing the sender identity in Terraform deleted its verification | Verify testers in the console; Terraform only manages the sender |
| credit: `SELF_SIGNED_CERT_IN_CHAIN` handling `UserVerified` | `.gitignore`'s `*.pem` hid the public RDS CA file, so Argo CD's `rds-ca` ConfigMap was empty | Un-ignore that folder, commit the file, restart Node services |
| Telegram-verified by SQL, but no credit wallet | Raw SQL skipped the `UserVerifiedOutbox` row that triggers `UserVerified` | `dev-verify-telegram.sh` queues it, like the real flow |

### Tooling traps

| Symptom | Cause | Fix / lesson |
|---|---|---|
| `kubectl run --overrides` started a Postgres *server* | Overrides replace the container, dropping the `-- psql …` args; the container name must match the pod's | Put `command` inside the override |
| `kubectl run -i`: *timed out waiting for the condition* | psql finished before kubectl attached | Detached pod + `kubectl wait` + `logs` |
| `rebase-merge directory already exists`; doubled Helm resources | iCloud `" 2"` copies (`.git/rebase-merge`, chart templates) | Delete identical copies; keep the repo out of iCloud if possible |
| `push-dev.sh`: order-service has uncommitted changes | Eclipse `.classpath`, `.project`, `.settings/` | Now in `.gitignore` |
| `local.sh` needed before `push-local.sh`; order 503 | Secret `order-user-lookup` wasn't generated (`generatedSecrets` missing) | A `secretEnv` needs its Secret's owner: `generatedSecrets` locally, `externalSecrets` in dev |

### Assistant mistakes (for next time)

- Claimed the OTP went to `e1397830@u.nus.edu`. That was a guess from the SES
  identity list; SES sends only to the address typed. Check, don't infer.
- An edit that silently didn't apply (`frontend_url`) and a placeholder regex
  bug were only caught later. Verify scripted edits by reading the result.
- Gave a `kubectl run --overrides` command that only worked by luck (pod and
  container both named `psql`).
- The first `dev-verify-telegram.sh` bypassed the outbox, so credit never
  heard about the user. Shortcuts around app logic must replicate its side
  effects.

## 4. Still open

- **Telegram bot**: create one with @BotFather (a separate bot from any
  local one: only one process may poll a bot) and paste its token and username
  into `foc/dev/user-telegram`. Until then use `dev-verify-telegram.sh`.
- **SES production access**: needed for unverified testers and the 200/day cap.
- **A domain we own**: DKIM-signed mail, out of Junk.
- **admin's user management** calls `/api/v1/user/search`, `/{id}/role` and
  `/{id}/status`, which user-service doesn't have. Needs the admin and user
  owners to agree an API.
- **Gemini key**: `foc/dev/admin-ai` is an empty placeholder.
- **stg**: add `"stg"` to `var.envs`, uncomment it in `nonprod.yaml`, add
  `deploy/values/envs/stg/`.
- **10 MB photo upload** through CloudFront → Envoy: not yet tried.
- `strimzi` shows `OutOfSync` on the `kafkas` CRD: harmless diff noise.
