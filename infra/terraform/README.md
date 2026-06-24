# Infrastructure (Terraform)

Provisions the AWS database for Riplo Arena: an RDS PostgreSQL instance in the
default VPC, a security group, and a Secrets Manager secret holding the full
`DATABASE_URL`. State lives in S3; the `terraform` GitHub Action plans on PRs
and **applies on merge to `main`/`master`**.

> The app itself deploys on **Vercel** (via Vercel's own GitHub integration) — Terraform owns AWS only.

---

## One-time bootstrap (you do this in the AWS account + GitHub)

### 1. S3 bucket for Terraform state
```bash
aws s3api create-bucket --bucket YOUR-TF-STATE-BUCKET --region YOUR-REGION \
  --create-bucket-configuration LocationConstraint=YOUR-REGION
aws s3api put-bucket-versioning --bucket YOUR-TF-STATE-BUCKET \
  --versioning-configuration Status=Enabled
```
(For `us-east-1`, omit the `--create-bucket-configuration` flag.)

### 2. GitHub OIDC provider + IAM role (so the Action can auth without static keys)
- IAM → Identity providers → add OpenID Connect:
  - Provider URL: `https://token.actions.githubusercontent.com`
  - Audience: `sts.amazonaws.com`
- Create an IAM role (e.g. `riplo-arena-terraform`) with this trust policy (restricts to this repo):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:RiploData/riplo-evals-battleground:*" }
      }
    }]
  }
  ```
- Attach permissions the apply needs: RDS, EC2 (VPC/subnet/security-group describe + SG manage), Secrets Manager, and S3 access to the state bucket. For a test account, `AdministratorAccess` is the quick option; scope it down for production.

### 3. GitHub repository **Variables** (Settings → Secrets and variables → Actions → Variables)
| Variable | Example | Purpose |
|---|---|---|
| `AWS_REGION` | `us-east-1` | region for resources + state (align with `vercel.json`) |
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/riplo-arena-terraform` | role the Action assumes via OIDC |
| `TF_STATE_BUCKET` | `your-tf-state-bucket` | S3 bucket from step 1 |

No secrets needed — auth is OIDC.

---

## Running it
- **PR** touching `infra/terraform/**` → the Action runs `plan` (review the diff).
- **Merge to main/master** → the Action runs `apply`.
- First apply takes a few minutes (RDS provisioning).

Local runs (optional):
```bash
cd infra/terraform
terraform init -backend-config="bucket=YOUR-TF-STATE-BUCKET" -backend-config="region=YOUR-REGION"
TF_VAR_aws_region=YOUR-REGION terraform plan
```

---

## After apply — wire the app
1. Get the connection string (it's not printed in CI):
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id riplo-arena/database-url \
     --query SecretString --output text
   ```
2. In **Vercel** set `DATABASE_URL` to that value and `DATABASE_SSL=true` (+ the rest of the env in `../../DEPLOY.md`).
3. Initialize the schema + corpus from your laptop (one time, and after schema changes):
   ```bash
   export DATABASE_URL='<from secrets manager>'
   export DATABASE_SSL=true
   npm run db:migrate
   npm run seed
   ```

## Customizing
- Region / instance size / allowed CIDR: see `variables.tf`. Override `db_allowed_cidr` to tighten DB access.
- **Aurora Serverless v2** instead of a single instance: replace `aws_db_instance` with an `aws_rds_cluster` + `aws_rds_cluster_instance` (engine `aurora-postgresql`, `serverlessv2_scaling_configuration`). The connection string / Secrets Manager output stay the same shape.
- **Teardown:** `terraform destroy` (or delete the resources) — `skip_final_snapshot` + `deletion_protection=false` are set for easy test teardown.
