#!/usr/bin/env bash
set -euo pipefail

echo "[localstack-cdk] Starting LocalStack CDK bootstrap+deploy..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Ensure required tools are available on host (awscli is optional if you already have aws CLI)
if ! command -v aws >/dev/null 2>&1; then
  echo "[localstack-cdk] WARNING: aws CLI not found on PATH; please install awscli if this script fails."
fi

# Load .env if present so things like AUTH_BYPASS can be toggled via env file.
if [ -f "${ROOT_DIR}/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "${ROOT_DIR}/.env" | xargs || true)
fi

# Make sure CDK sees dummy account/region and talks to LocalStack
export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-test}
export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-test}
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-ap-southeast-2}
export AWS_EC2_METADATA_DISABLED=true

cd "${ROOT_DIR}"

echo "[localstack-cdk] Bootstrapping and deploying CDK stack to LocalStack..."

cd cdk
npm install
npx cdklocal bootstrap
npx cdklocal deploy --require-approval never

echo "[localstack-cdk] Discovering LocalStack HTTP API ID..."

# LocalStack's apigatewayv2 APIs are surfaced in us-east-1 by default
API_ID=$(aws --endpoint-url=http://localhost:4566 apigatewayv2 get-apis --region us-east-1 --query 'Items[0].ApiId' --output text)

if [ -z "${API_ID}" ] || [ "${API_ID}" = "None" ]; then
  echo "[cdk-deploy] ERROR: Could not discover API ID from LocalStack." >&2
  exit 1
fi

BASE="http://localhost:4566/_aws/execute-api/${API_ID}"

cd "${ROOT_DIR}"

cat > .localstack-api.env <<EOF
API_ID=${API_ID}
BASE=${BASE}
EOF

echo "==============================================="
echo "[cdk-deploy] LocalStack Financial Events API is ready."
echo "API_ID: ${API_ID}"
echo "BASE:   ${BASE}"
echo
echo "To run Newman locally:"
echo "  source .localstack-api.env"
echo "  npx -y newman run postman/financial-events-localstack.collection.json --env-var apiId=\"\$API_ID\""
echo "==============================================="

