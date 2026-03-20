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
- `GET /charts` defaults to plotting underlying `stock_ohlc` data.
