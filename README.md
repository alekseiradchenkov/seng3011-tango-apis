## SENG3011 Team Tango — Financial Events APIs

This repo is a small **AWS-style microservices system** for collecting, storing, retrieving, and visualising financial-event datasets.

### Repository Structure

#### Services

- **`services/collection/`**: dataset creation + ingestion (`POST /v1/datasets`, `POST /v1/datasets/{datasetId}/events/fetch`)
- **`services/retrieval/`**: dataset listing + querying + stats + export (GET endpoints)
- **`services/visualisation/`**: visualisation endpoints (`/v1/events/*`, `/v1/charts/*`)
- **`services/auth/`**: Cognito-backed user signup/login/logout (`/v1/auth/*`)
- **`shared/`**: shared types/auth helpers used across services

#### Other

- **`cdk/`**: AWS CDK app that deploys the stack (API Gateway + Lambdas + DynamoDB + S3) into AWS/LocalStack
- **`postman/`**: Postman collection(s) to exercise the APIs locally for developer testing

### Architecture (high level)

- Single **API Gateway HTTP API**
- 3 **Lambda functions** (Express apps via `@vendia/serverless-express`):
  - `collection`: creates datasets and ingests OHLC data from Yahoo Finance
  - `retrieval`: lists/query datasets, stats, CSV export
  - `visualisation`: placeholder visualisation endpoints
- **DynamoDB**:
  - `EventIndex` (dataset metadata and filters)
  - `Charts` (visualisation-related data)
- **S3**:
  - Raw price data + per-dataset event snapshots

CloudFormation (via CDK) is responsible for provisioning and naming resources across redeploys.

### Local development (LocalStack + CDK)

#### Prerequisites

- Docker and docker compose
- Node.js 20+
- AWS CLI installed and on `PATH`
- Create a local `.env` file by copying the required environment variables from [Confluence env vars](https://unswcse.atlassian.net/wiki/x/cYCcX).

All LocalStack resources use **dummy AWS credentials** and the default LocalStack account/region.

#### One-time setup

From the repo root (`seng3011-tango-apis`):

```bash
docker compose up -d
bash scripts/localstack-cdk-deploy.sh
```

This will:

- Start LocalStack (API Gateway, Lambda, DynamoDB, S3, Cognito, etc.)
- Bootstrap CDK into LocalStack
- Deploy the `FinancialEventsStack` into LocalStack (respecting any `AUTH_BYPASS` value set in your `.env`)
- Discover the HTTP API ID and write `.localstack-api.env` at the repo root, e.g.:
  - `API_ID=1b893d80`
  - `BASE=http://localhost:4566/_aws/execute-api/1b893d80`

On subsequent runs (after LocalStack is already running), you can just re-run:

```bash
bash scripts/localstack-cdk-deploy.sh
```

It will update the stack if needed and refresh `.localstack-api.env`.

- By default (including in CI/AWS), `AUTH_BYPASS` is **false**, so all business Lambdas enforce full Cognito auth.
- For LocalStack/local development, you can set `AUTH_BYPASS=true` in your `.env` before running the script to tell the collection/retrieval/visualisation Lambdas to skip strict Cognito checks and treat requests as coming from a local dev user.

### Testing endpoints locally

**Option A: Newman (full E2E, recommended)**

1. Load the API ID and base URL that `scripts/localstack-cdk-deploy.sh` wrote:

   ```bash
   source .localstack-api.env
   echo "API_ID=${API_ID}"
   echo "BASE=${BASE}"
   ```

2. Run the Newman collection using this API ID:

   ```bash
   npx -y newman run postman/financial-events-localstack.collection.json --env-var apiId="${API_ID}"
   ```

This runs an end-to-end flow against LocalStack:
- signup/login via the `auth` service (Cognito-backed; in LocalStack, `signup` may occasionally return a 500 even though `login` still succeeds)
- create dataset
- fetch events (from Yahoo Finance)
- list datasets
- get events
- get stats
- export CSV

All dataset and retrieval steps are expected to pass when LocalStack + CDK + Yahoo Finance are reachable.

**Option B: curl (quick checks)**

After running `scripts/localstack-cdk-deploy.sh` once in this LocalStack session:

1. Ensure `.localstack-api.env` is loaded:

   ```bash
   source .localstack-api.env
   ```

2. Example (list datasets; if you deployed with `AUTH_BYPASS=true` in `.env`, the Lambdas will treat requests as coming from a local dev user):

   ```bash
   curl -sS -i "$BASE/v1/datasets"
   ```

### Auth & data source notes

- **Local / LocalStack auth**:
  - The `auth` microservice uses Cognito (or the LocalStack Cognito emulator) for `/v1/auth/signup` and `/v1/auth/login`.
  - For local development, the core business Lambdas (`collection`, `retrieval`, `visualisation`) are typically deployed with `AUTH_BYPASS=true`, which skips strict Cognito JWT verification and treats incoming requests as a local user (no header required).
- **Real AWS auth**:
  - For production, deploy with `AUTH_BYPASS=false` and configure Cognito User Pool/User Pool Client environment variables; the shared auth helpers will enforce JWT verification using `aws-jwt-verify`.
- **Market data source**:
  - Collection uses Yahoo Finance’s **unofficial chart endpoint** to fetch daily OHLC data.
