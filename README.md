## Financial Events APIs

Local microservices stack for auth, collection, retrieval, docs, and chart visualisation.

## Prerequisites

1. Install Node.js 20+ (includes npm): [Node.js Downloads](https://nodejs.org/en/download)

2. Install Docker Engine + Docker Compose: [Docker Engine Install](https://docs.docker.com/engine/install/) and [Docker Compose Install](https://docs.docker.com/compose/install/)

3. Install AWS CLI v2.

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
sudo ./aws/install
aws --version
```

4. Install LocalStack CLI.

```bash
python3 -m pip install --user --upgrade localstack awscli-local
~/.local/bin/localstack --version
```

5. Install CDK, `cdklocal`, and Newman globally.

```bash
npm install -g aws-cdk aws-cdk-local newman
cdk --version
cdklocal --version
newman --version
```

6. Create local `.env` from the required variables here: [Confluence env vars](https://unswcse.atlassian.net/wiki/x/cYCcX)

## User Guide (LocalStack)

1. Start LocalStack.

```bash
docker compose up -d
```

2. Deploy stack to LocalStack (bootstrap + deploy + API env output).

```bash
bash scripts/localstack-cdk-deploy.sh
```

The stack uses **AWS Lambda Node.js 18** (`nodejs18.x`). LocalStack’s emulator does not accept `nodejs20.x`; production AWS still runs this stack fine on 18.x. Use Node 20+ locally for npm/CDK if you prefer.

3. Load generated API environment values.

```bash
source .localstack-api.env
echo "$API_ID"
echo "$BASE"
```

4. Run system-tests 1-5.

```bash
# system-test-1
newman run integration-tests/integration-test-1.collection.json --env-var apiId="$API_ID"

# system-test-2
newman run integration-tests/integration-test-2.collection.json --env-var apiId="$API_ID"

# system-test-3
newman run integration-tests/integration-test-3.collection.json --env-var apiId="$API_ID"

# system-test-4
newman run integration-tests/integration-test-4.collection.json --env-var apiId="$API_ID"

# system-test-5
newman run integration-tests/integration-test-5.collection.json --env-var apiId="$API_ID"
```

5. (Optional) Invoke the **E2E runner Lambda** deployed by CDK (runs all five Newman collections in one call). After `bash scripts/localstack-cdk-deploy.sh`, `source .localstack-api.env` sets `E2E_RUNNER_FUNCTION_NAME` and the script has already pointed the function at `BASE`.

```bash
source .localstack-api.env
aws --endpoint-url=http://localhost:4566 lambda invoke \
  --region "${AWS_DEFAULT_REGION}" \
  --function-name "$E2E_RUNNER_FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' /tmp/e2e-out.json && cat /tmp/e2e-out.json
```

The response JSON includes `ok: true` when every collection run succeeds.

## CI: coverage reports

The **test** workflow (`.github/workflows/test.yml`) runs a **lint** matrix and a **test** matrix over the same five services, then aggregates results into one report.

- **Per-service `coverage-*` artifacts** — Jest is run with `--coverage --json --outputFile=coverage/jest-results.json`. Uploaded `coverage/` includes **`jest-results.json`**, **`jest.exitcode`**, **`jest-coverage-log.txt`**, Istanbul outputs (`coverage-summary.json`, `lcov.info`, HTML, etc.).
- **Per-service `lint-*` artifacts** — ESLint is run as **`npm run lint -- -f json -o lint/eslint-report.json`**, plus **`eslint.exitcode`**. (The standalone **lint** workflow in `lint.yml` still runs on the same events, so lint executes twice—once for this combined report, once as a dedicated check.)
- **`coverage-combined` artifact** — The final job downloads all **`coverage-*`** and **`lint-*`** artifacts and runs **`scripts/generate-combined-ci-report.js`**, which writes **`COMBINED-CI-REPORT.md`** / **`.txt`** (overview table, per-service **Tests / Coverage / Lint**, failing tests with excerpts, ESLint findings table, combined coverage totals), **`coverage-summary.json`**, and compatibility copies **`COVERAGE-REPORT.*`** (same content as the combined report).
- **Workflow summary** — The full **`COMBINED-CI-REPORT.md`** is appended to the GitHub Actions run summary.

Locally: `node scripts/generate-combined-ci-report.js <coverage-parts-dir> <lint-parts-dir> <out-dir>` (or `node scripts/aggregate-coverage-summary.js` for merged coverage JSON only).

## CI: pull requests vs deploy (E2E)

- **Pull requests** run the **test** workflow (lint + unit tests per service, combined report) and the **lint** workflow. They do **not** deploy to AWS dev/prod.
- The matrix job named **`e2e-runner`** runs **Jest** in `services/e2e-runner` (unit tests for the runner code). That is unrelated to invoking the deployed Lambda.
- **Newman / HTTP E2E** against the real API runs only after a **successful deploy** in **`aws-deploy`** (push to `main` or manual workflow), which invokes the **E2E runner Lambda** in AWS.

## Per-Service Docker (Not Recommended)

As per assessment requirements, per service docker containers have been created. However, the localStack deployment flow is the recommended path as it is far more robust and accurate. With our localstack flow, we deploy the stack through our CDK + CloudFormation flow using the localstack docker container in our [docker-compose.yml] file and we mock AWS infrastructure end-to-end (API Gateway, Lambda, DynamoDB, S3, Cognito, IAM, etc.).

With this in mind, you can run the per-service containers as follows:

```bash
# auth (host port 3001 -> container port 3000)
docker build -t tango-auth ./services/auth
docker run --rm -p 3001:3000 --env-file .env -e PORT=3000 tango-auth

# collection (host port 3002 -> container port 3000)
docker build -t tango-collection ./services/collection
docker run --rm -p 3002:3000 --env-file .env -e PORT=3000 tango-collection

# retrieval (host port 3003 -> container port 3000)
docker build -t tango-retrieval ./services/retrieval
docker run --rm -p 3003:3000 --env-file .env -e PORT=3000 tango-retrieval

# visualisation (host port 3004 -> container port 3000)
docker build -t tango-visualisation ./services/visualisation
docker run --rm -p 3004:3000 --env-file .env -e PORT=3000 tango-visualisation
```

## Notes

- Routes are unversioned (for example: `/datasets`, `/charts`, `/docs`, `/status`).
- `PUT /datasets/{id}/events` stores raw OHLC and deterministic derived events together.
- `GET /charts` returns a candlestick PNG from `stock_ohlc` events.
