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

# Point the CDK-deployed E2E runner Lambda at LocalStack from inside Lambda networking.
LS_ENDPOINT="http://localhost:4566"
LAMBDA_LOCALSTACK_HOST=${LAMBDA_LOCALSTACK_HOST:-localstack}
E2E_BASE="http://${LAMBDA_LOCALSTACK_HOST}:4566/_aws/execute-api/${API_ID}"
E2E_FN=""
for REGION_TRY in "${AWS_DEFAULT_REGION:-ap-southeast-2}" "us-east-1"; do
  E2E_FN="$(aws --endpoint-url="${LS_ENDPOINT}" cloudformation describe-stacks \
    --region "${REGION_TRY}" \
    --stack-name "FinancialEventsStack-dev" \
    --query "Stacks[0].Outputs[?OutputKey=='E2eRunnerFunctionName'].OutputValue" \
    --output text 2>/dev/null || true)"
  if [ -n "${E2E_FN}" ] && [ "${E2E_FN}" != "None" ]; then
    export AWS_DEFAULT_REGION="${REGION_TRY}"
    break
  fi
done

if [ -n "${E2E_FN}" ] && [ "${E2E_FN}" != "None" ]; then
  echo "[localstack-cdk] Configuring E2E runner Lambda (${E2E_FN}) with API_BASE_URL=${E2E_BASE} ..."
  aws --endpoint-url="${LS_ENDPOINT}" lambda update-function-configuration \
    --region "${AWS_DEFAULT_REGION}" \
    --function-name "${E2E_FN}" \
    --environment "Variables={API_BASE_URL=${E2E_BASE}}" \
    >/dev/null
  # Wait until the new configuration is active (LocalStack may ignore 'wait'; short sleep is harmless).
  sleep 2 || true
else
  echo "[localstack-cdk] WARNING: Could not resolve E2eRunnerFunctionName from stack outputs; skip E2E Lambda env update."
fi

cat > .localstack-api.env <<EOF
API_ID=${API_ID}
BASE=${BASE}
E2E_RUNNER_FUNCTION_NAME=${E2E_FN}
EOF

echo "==============================================="
echo "[cdk-deploy] LocalStack Financial Events API is ready."
echo "API_ID: ${API_ID}"
echo "BASE:   ${BASE}"
if [ -n "${E2E_FN}" ] && [ "${E2E_FN}" != "None" ]; then
  echo "E2E runner Lambda: ${E2E_FN}"
fi
echo
echo "To run Newman locally (same collections as the E2E Lambda):"
echo "  source .localstack-api.env"
echo "  newman run integration-tests/integration-test-1.collection.json --env-var apiId=\"\$API_ID\""
echo
echo "To invoke the E2E runner Lambda (runs all integration-test-*.collection.json):"
echo "  source .localstack-api.env"
echo "  aws --endpoint-url=${LS_ENDPOINT} lambda invoke --region \${AWS_DEFAULT_REGION} --function-name \"\$E2E_RUNNER_FUNCTION_NAME\" --cli-binary-format raw-in-base64-out --payload '{}' /tmp/e2e-out.json && cat /tmp/e2e-out.json"
echo "==============================================="

