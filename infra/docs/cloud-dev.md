# Dev on AWS: requirements and first bring-up

How to bring up the **dev** env on real AWS:

- an EKS cluster `foc-nonprod` with namespace `foc-dev`
- Argo CD
- the web app at `https://<id>.cloudfront.net` (no custom domain), served from
  S3 and CloudFront, with
  `/api/*` going to the Envoy gateway

The design is in [ADR-0013](adr/0013-cloudfront-vpc-origin-and-external-secrets.md).
Costs are in [`dev-cost-estimate.md`](dev-cost-estimate.md); expect about $40 a
month if dev is torn down when idle.

> **Status (2026-10-22):** `infra/nonprod/aws` was first applied to the NUS
> account on 2026-10-22. That run showed that NUS's service control policy
> blocks per-pod AWS roles and GitHub OIDC (see "NUS AWS account limits"
> below), so pods now use the node role, and images and the frontend are
> pushed from a laptop.

## 1. Requirements

### Access and accounts

- [ ] **AWS account** and an admin login for whoever runs Terraform (IAM
      Identity Center or an IAM user), with MFA on.
- [ ] **AWS Budget** with an email alert, for example at $60/month, created
      before the first apply.
- [ ] **No domain needed.** Dev uses CloudFront's own `*.cloudfront.net` name
      and certificate. To add a domain later, see the comment in
      `infra/nonprod/aws/frontend.tf`.
- [ ] **A sender mailbox for SES** that you can open (`-var ses_from_email=…`).
      After the apply, SES emails it a verification link: click it, or every
      send fails. Sending from a free-mail address (Gmail etc.) through SES
      may land in spam, since it isn't signed for that domain; fine for dev.
      New accounts are also in the **SES sandbox**: mail only goes to verified
      addresses, 200 a day.
      - Verify each tester's address (SES console → Identities), or
      - **request production access** early. AWS takes about a day.
- [ ] **An SSO login to the NUS account** (`aws configure sso`, profile
      `cs3219-dev` here). It's used for Terraform, kubectl and pushing images.

### NUS AWS account limits

The NUS organization's service control policy (SCP), which we can't change,
explicitly denies:

| Denied | Effect on us | What we do instead |
|---|---|---|
| `eks-auth:AssumeRoleForPodIdentity`, `sts:AssumeRoleWithWebIdentity` (Pod Identity, IRSA) | Pods can't have their own IAM roles | Pods use the **node role** (`infra/nonprod/aws/node-permissions.tf`). Every pod shares it; [ADR-0013](adr/0013-cloudfront-vpc-origin-and-external-secrets.md) has the trade-off and how to revert |
| `sts:AssumeRole` from a role | External Secrets can't switch to a per-env role | Its stores use the node role too |
| `sts:AssumeRoleWithWebIdentity` (GitHub OIDC) and `iam:CreateUser` | GitHub Actions can't log in to AWS: no OIDC role and no access keys | Steps 6 and 8 run **from a laptop** with your SSO login. `deploy-dev.yml` and `frontend-dev.yml` stay in the repo for an account without these limits. `ci.yml` (tests) needs no AWS and still works |

Check an action yourself with IAM's policy simulator, which includes the SCP:
```bash
aws iam simulate-principal-policy --policy-source-arn <role ARN> --action-names <action> \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision,OrganizationsDecisionDetail.AllowedByOrganizations]'
```

### Tools on your machine

Terraform 1.16.4 (`infra/.terraform-version`), AWS CLI v2, kubectl, helm, jq,
Docker, and Node 22 (for the frontend build). On an Apple Silicon Mac, Docker
builds arm64 natively, which is what the t4g nodes need.

### Values to decide

| What | Where |
|---|---|
| Sender address | `-var ses_from_email=…` on `infra/nonprod/aws` |
| Who gets kubectl access | `-var 'cluster_admin_arns=["arn:aws:iam::…:role/…"]'` (whoever applies always gets it) |

## 2. What runs where

| Layer | Terraform root | State key |
|---|---|---|
| State bucket | `infra/state` | local file (one-off) |
| Image registry, shared by every env | `infra/global/ecr` | `global/ecr` |
| CI role (GitHub OIDC). Unusable in the NUS account; apply it anyway, `nonprod/aws` reads its output | `infra/global/github-oidc` | `global/github-oidc` |
| VPC, EKS, RDS, secrets, node-role permissions, SES, photos bucket, gateway NLB, CloudFront | `infra/nonprod/aws` | `nonprod/aws` |
| Argo CD and the root app | `infra/nonprod/bootstrap` | `nonprod/bootstrap` |

Argo CD then syncs everything in `deploy/argocd/nonprod.yaml`:

- **Platform:** Strimzi, Envoy Gateway, cert-manager, trust-manager, Linkerd,
  the AWS Load Balancer Controller, External Secrets, and `cluster-config`.
- **Per env:** the namespace, Kafka, the databases, the services and the
  gateway.

## 3. First bring-up

Every cloud root keeps its state in the bucket from step 1. Pass the bucket
name with `-backend-config` and `-var state_bucket`:

```bash
export AWS_PROFILE=<your profile>   # an admin in the target account
B=foc-tfstate-$(aws sts get-caller-identity --query Account --output text)
```

1. **State bucket** (once per account):
   ```bash
   terraform -chdir=infra/state init && terraform -chdir=infra/state apply
   ```
2. **Registry and CI role:**
   ```bash
   terraform -chdir=infra/global/ecr init -backend-config="bucket=$B"
   terraform -chdir=infra/global/ecr apply
   terraform -chdir=infra/global/github-oidc init -backend-config="bucket=$B"
   terraform -chdir=infra/global/github-oidc apply -var state_bucket=$B   # reads ecr's outputs
   ```
3. **The cluster and everything AWS:** about 20 minutes. EKS and CloudFront
   are the slow parts. Then click the link SES emailed to the sender address.
   ```bash
   terraform -chdir=infra/nonprod/aws init -backend-config="bucket=$B"
   terraform -chdir=infra/nonprod/aws apply -var state_bucket=$B -var ses_from_email=you@example.com
   ```
4. **Copy the outputs into git.** These are ARNs, hostnames and the RDS
   endpoint; none are secrets.
   ```bash
   deploy/cloud-values.sh nonprod      # fills every TF:<output> placeholder
   git diff                            # review, then commit and push to main
   ```
   Argo CD reads `main`, so this commit must be on `main` before step 5 syncs
   anything useful.
5. **Argo CD:**
   ```bash
   terraform -chdir=infra/nonprod/bootstrap init -backend-config="bucket=$B"
   terraform -chdir=infra/nonprod/bootstrap apply -var state_bucket=$B
   aws eks update-kubeconfig --name foc-nonprod --region ap-southeast-1
   terraform -chdir=infra/nonprod/aws output -json envs | jq -r .dev.frontend_url   # dev's URL
   kubectl -n argocd get applications -w
   ```
   - The platform apps come up first. The env apps retry until the CRDs they
     need exist.
   - The services stay `Degraded` with `image.tag is required` until step 6.
6. **Push the images from your laptop** with `deploy/push-dev.sh`. It does
   what `deploy-dev.yml` would, which can't log in here:
   ```bash
   export AWS_PROFILE=cs3219-dev     # and `aws sso login` if the session expired
   deploy/push-dev.sh                # every image dev runs; or name some: deploy/push-dev.sh credit order
   git push                          # then merge to main: Argo CD deploys from main
   ```
   For each service it:
   - builds `linux/arm64`, natively on Apple Silicon
   - tags the image with the **last commit that changed that service's
     folder**, so unchanged services aren't rebuilt
   - pushes `foc/<svc>-service:<sha>`, plus `:<sha>-migrate` when the
     Dockerfile has a `migrate` stage
   - pushes `connectivity-stub:0.2.0` for rating and badges
   - commits the new tags to `deploy/values/envs/dev/services/`

   It refuses a service folder with uncommitted changes, since the image must
   match the commit it's named after. `--no-commit` edits the values files
   without committing.
7. **Mesh the pods that started before Linkerd.** The injector fails open, as
   `remesh()` in `deploy/local.sh` handles locally:
   ```bash
   kubectl -n foc-dev rollout restart deploy
   kubectl -n envoy-gateway-system rollout restart deploy
   ```
8. **Publish the frontend from your laptop** (same as `frontend-dev.yml`):
   ```bash
   set -a; . .github/cloud/dev.env; set +a        # FRONTEND_BUCKET, CLOUDFRONT_ID (filled in step 4)
   (cd frontend && npm ci && npm run build)
   aws s3 sync frontend/dist/assets "s3://$FRONTEND_BUCKET/assets" --cache-control "public,max-age=31536000,immutable"
   aws s3 sync frontend/dist "s3://$FRONTEND_BUCKET" --exclude "assets/*" --exclude index.html --cache-control "public,max-age=300"
   aws s3 cp frontend/dist/index.html "s3://$FRONTEND_BUCKET/index.html" --cache-control no-cache
   aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/*"
   ```
9. **First admin.** Test verification
   (`POST /api/v1/user/admin/users/{id}/verify`, enabled in dev) needs an
   admin. `bootstrap-admin` needs a user that is already verified, so the first
   one is done by hand:
   1. Sign up at dev's URL with a verified SES recipient, and
      confirm the OTP.
   2. Mark that user Telegram-verified, since there is no bot yet. Use a
      throwaway pod with `envFrom: secretRef user-db`:
      ```sql
      UPDATE "User" SET "telegramVerifiedAt" = now() WHERE email = '<you>@u.nus.edu';
      ```
   3. Make them admin:
      ```bash
      kubectl -n foc-dev exec deploy/user -c user -- node dist/bootstrap-admin.js --user-id <uuid> --confirm
      ```
   4. From then on, use the admin's verify endpoint for other testers.

After this, rerun step 6 for a changed service (`deploy/push-dev.sh <svc>`) and
step 8 for a frontend change. In an account without the NUS limits, the two
workflows do this on every merge to `main`.

## 4. Check it works

```bash
D=$(terraform -chdir=infra/nonprod/aws output -json envs | jq -r .dev.frontend_url)
curl -sI $D/ | head -1                                  # 200, text/html
curl -sI $D/orders/123 | grep -i content-type           # text/html (SPA fallback)
curl -s  $D/api/v1/orders/x                             # JSON 401, not HTML
curl -s -o /dev/null -w '%{http_code}\n' $D/api/v1/credit/internal/reserve   # 404 (blocked)
kubectl -n foc-dev get pods                             # every pod 2/2 (meshed)
kubectl -n foc-dev get externalsecrets                  # all SecretSynced
kubectl -n envoy-gateway-system get targetgroupbindings # gateway-dev present
```

- Sign up with a verified SES recipient: the OTP email arrives. The reset link
  points at dev's CloudFront URL.
- Create an order and upload a collection photo (up to 10 MB). The object
  appears in `foc-dev-order-photos-<account>`. Restart the order pod, and the
  order still shows the photo.
- Order reserves credit: this proves RDS TLS, the mesh policy and Kafka in the
  cloud.

## 5. Day to day

| Task | How |
|---|---|
| Deploy a service | Commit the change, run `deploy/push-dev.sh <svc>`, push, and merge to `main`. In an account without the NUS limits, merging to `main` runs deploy-dev instead. |
| Roll back | `git revert` the tag-bump commit. |
| Argo CD UI | `kubectl -n argocd port-forward svc/argocd-server 8081:80`. The password is in Secret `argocd-initial-admin-secret`. |
| Logs | `kubectl -n foc-dev logs deploy/<svc> -c <svc>` |
| Rotate an app secret | `terraform -chdir=infra/nonprod/aws apply -replace='random_password.app["dev/user-otp/OTP_SECRET"]'`. External Secrets picks it up within 1 h, or annotate the ExternalSecret `force-sync=$(date +%s)`. Restart the pods. |
| Pause dev (save ~$5/day) | `terraform -chdir=infra/nonprod/bootstrap destroy`, then `infra/nonprod/aws destroy`. ECR, the CI role and state stay. Bring it back with steps 3–8. Step 4's commit still applies, unless the ARNs changed: rerun `cloud-values.sh` after resetting the files to their `TF:` placeholders. |

## 6. Not built yet

- **Telegram bot.** Users are verified by the admin endpoint until it exists.
  Order calls need a verified user.
- **Gemini key for admin.** Secrets Manager `foc/dev/admin-ai` is an empty
  placeholder, so conflict cases end as `ai_failed` and wait for an admin.
  Paste the key there; External Secrets syncs it within the hour, then restart
  admin. rating and badges have no code yet and run the stub.
- **stg.** Add `"stg"` to `var.envs` in `infra/nonprod/aws`, uncomment the stg
  lines in `deploy/argocd/nonprod.yaml`, add `foc-stg` to Strimzi's
  `watchNamespaces` (`deploy/values/clusters/nonprod/strimzi.yaml`; the operator
  exits if it watches a namespace that doesn't exist), add
  `deploy/values/envs/stg/`, and raise `var.node_count`.
- **Upload size through the gateway.** CloudFront accepts 10 MB. Check that
  Envoy does too, on the first photo upload.
