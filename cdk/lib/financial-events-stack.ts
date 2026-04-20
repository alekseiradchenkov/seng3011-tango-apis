import * as path from "path";
import * as fs from "fs";
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_integrations as apigwIntegrations,
  aws_dynamodb as dynamodb,
  aws_s3 as s3,
  aws_cognito as cognito,
  aws_iam as iam,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";

/**
 * Node 18 is required for LocalStack: its Lambda emulator does not accept `nodejs20.x`.
 * AWS Lambda supports 18.x for the same bundle; local dev may still use Node 20+ on the host.
 */
const LAMBDA_RUNTIME = Runtime.NODEJS_18_X;

/**
 * Props for {@link FinancialEventsStack}.
 */
interface FinancialEventsStackProps extends StackProps {
  /**
   * Deployment stage identifier (for example: `dev`, `prod`).
   * Used to suffix resource names and exports.
   */
  stage?: string;
}

/**
 * CDK stack wiring together HTTP API, Lambdas, Cognito, DynamoDB, S3 and the E2E test runner.
 */
export class FinancialEventsStack extends Stack {
  constructor(scope: Construct, id: string, props?: FinancialEventsStackProps) {
    super(scope, id, props);

    const stage = props?.stage || "dev";

    const retentionPolicy = RemovalPolicy.RETAIN;

    const allowAuthBypass = ["1", "true"].includes(
      (process.env.AUTH_BYPASS ?? "").toLowerCase().trim(),
    );

    // Cognito User Pool + Client
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: retentionPolicy,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        adminUserPassword: true,
      },
    });

    // DynamoDB table for dataset metadata
    const eventIndexTable = new dynamodb.Table(this, "EventIndexTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retentionPolicy,
    });

    // S3 bucket for event datasets
    const eventsBucket = new s3.Bucket(this, "EventDatasetsBucket", {
      removalPolicy: retentionPolicy,
    });

    // Collection Lambda
    const collectionFunction = new NodejsFunction(this, "CollectionFunction", {
      entry: path.join(__dirname, "..", "..", "services", "collection", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "collection", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: ["@vendia/serverless-express", "aws-jwt-verify", "cors", "express", "morgan"],
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        EVENT_INDEX_TABLE: eventIndexTable.tableName,
        EVENTS_BUCKET: eventsBucket.bucketName,
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    // Retrieval Lambda
    const retrievalFunction = new NodejsFunction(this, "RetrievalFunction", {
      entry: path.join(__dirname, "..", "..", "services", "retrieval", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "retrieval", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: ["@vendia/serverless-express", "aws-jwt-verify", "cors", "express", "morgan"],
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        EVENT_INDEX_TABLE: eventIndexTable.tableName,
        EVENTS_BUCKET: eventsBucket.bucketName,
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    // Visualisation Lambda
    const visualisationFunction = new NodejsFunction(this, "VisualisationFunction", {
      entry: path.join(__dirname, "..", "..", "services", "visualisation", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "visualisation", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      bundling: {
        nodeModules: [
          "@vendia/serverless-express",
          "aws-jwt-verify",
          "cors",
          "express",
          "morgan",
          "chart.js",
          "chartjs-node-canvas",
        ],
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        EVENTS_BUCKET: eventsBucket.bucketName,
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    // Predictive Lambda (risk forecasting)
    const predictiveFunction = new NodejsFunction(this, "PredictiveFunction", {
      entry: path.join(__dirname, "..", "..", "services", "predictive", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "predictive", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      bundling: {
        nodeModules: ["@vendia/serverless-express", "aws-jwt-verify", "cors", "express", "morgan"],
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        EVENT_INDEX_TABLE: eventIndexTable.tableName,
        EVENTS_BUCKET: eventsBucket.bucketName,
        MANGO_BASE_URL: process.env.MANGO_BASE_URL ?? "https://x9rgu2z2vh.execute-api.us-east-1.amazonaws.com/prod",
        GRIDX_HF_BASE_URL: process.env.GRIDX_HF_BASE_URL ?? "https://a13awd-electricity-grid-model.hf.space/gradio_api",
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    // Auth Lambda
    const authFunction = new NodejsFunction(this, "AuthFunction", {
      entry: path.join(__dirname, "..", "..", "services", "auth", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "auth", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: ["@vendia/serverless-express", "cors", "express", "morgan"],
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    // Docs Lambda (serves swagger and status)
    const docsFunction = new NodejsFunction(this, "DocsFunction", {
      entry: path.join(__dirname, "docs-handler.ts"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.seconds(10),
      bundling: {
        nodeModules: ["@vendia/serverless-express", "cors", "express", "swagger-ui-express"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir: string, outputDir: string) => [
            `cp "${path.join(__dirname, "swagger.json")}" "${path.join(outputDir, "swagger.json")}"`,
          ],
        },
      },
    });

    authFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:GlobalSignOut",
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    // Permissions
    eventIndexTable.grantReadWriteData(collectionFunction);
    eventIndexTable.grantReadData(retrievalFunction);
    eventIndexTable.grantReadData(predictiveFunction);

    eventsBucket.grantReadWrite(collectionFunction);
    eventsBucket.grantRead(retrievalFunction);
    eventsBucket.grantRead(visualisationFunction);
    // Predictive reads datasets and writes trained models into the same bucket under `models/`.
    eventsBucket.grantReadWrite(predictiveFunction);

    // HTTP API
    const httpApi = new apigw.HttpApi(this, "FinancialEventsApi", {
      apiName: `financial-events-api-${stage}`,
    });

    const collectionIntegration = new apigwIntegrations.HttpLambdaIntegration("CollectionIntegration", collectionFunction);
    const retrievalIntegration = new apigwIntegrations.HttpLambdaIntegration("RetrievalIntegration", retrievalFunction);
    const visualisationIntegration = new apigwIntegrations.HttpLambdaIntegration("VisualisationIntegration", visualisationFunction);
    const predictiveIntegration = new apigwIntegrations.HttpLambdaIntegration("PredictiveIntegration", predictiveFunction);
    const authIntegration = new apigwIntegrations.HttpLambdaIntegration("AuthIntegration", authFunction);
    const docsIntegration = new apigwIntegrations.HttpLambdaIntegration("DocsIntegration", docsFunction);

    // Base URL — redirect to Swagger UI (handled in docs-handler)
    httpApi.addRoutes({
      path: "/",
      methods: [apigw.HttpMethod.GET],
      integration: docsIntegration,
    });

    // Docs & Status routes (public)
    httpApi.addRoutes({
      path: "/docs",
      methods: [apigw.HttpMethod.GET],
      integration: docsIntegration,
    });
    httpApi.addRoutes({
      path: "/docs/{proxy+}",
      methods: [apigw.HttpMethod.GET],
      integration: docsIntegration,
    });
    httpApi.addRoutes({
      path: "/status",
      methods: [apigw.HttpMethod.GET],
      integration: docsIntegration,
    });

    // Auth routes
    httpApi.addRoutes({
      path: "/auth/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: authIntegration,
    });

    // Collection routes (write operations)
    httpApi.addRoutes({
      path: "/datasets",
      methods: [apigw.HttpMethod.POST],
      integration: collectionIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}",
      methods: [apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],
      integration: collectionIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}/events",
      methods: [apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],
      integration: collectionIntegration,
    });

    // Retrieval routes (read operations)
    httpApi.addRoutes({
      path: "/datasets",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}/events",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}/events/stats",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/datasets/{datasetId}/export",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });

    // Visualisation routes (stateless chart rendering)
    httpApi.addRoutes({
      path: "/charts",
      methods: [apigw.HttpMethod.GET],
      integration: visualisationIntegration,
    });

    // Predictive routes (risk forecasting)
    httpApi.addRoutes({
      path: "/predict/models/train",
      methods: [apigw.HttpMethod.POST],
      integration: predictiveIntegration,
    });
    httpApi.addRoutes({
      path: "/predict/run",
      methods: [apigw.HttpMethod.POST],
      integration: predictiveIntegration,
    });
    httpApi.addRoutes({
      path: "/predict/electricity-shock",
      methods: [apigw.HttpMethod.GET],
      integration: predictiveIntegration,
    });
    httpApi.addRoutes({
      path: "/predict/macro-summary",
      methods: [apigw.HttpMethod.GET],
      integration: predictiveIntegration,
    });

    const integrationTestsRoot = path.join(__dirname, "..", "..", "integration-tests");
    const integrationTestCollections = fs
      .readdirSync(integrationTestsRoot)
      .filter((f) => f.endsWith(".collection.json"));

    // E2E runner Lambda (invoke via AWS CLI or CI; not exposed on the HTTP API)
    const e2eRunnerFunction = new NodejsFunction(this, "E2eRunnerFunction", {
      entry: path.join(__dirname, "..", "..", "services", "e2e-runner", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "e2e-runner", "package-lock.json"),
      runtime: LAMBDA_RUNTIME,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      bundling: {
        nodeModules: ["newman"],
        externalModules: ["@aws-sdk/*"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir: string, outputDir: string) => {
            const outDir = path.join(outputDir, "integration-tests");
            // Copy all Postman collections shipped in `integration-tests/` without
            // needing to update this stack when new ones are added.
            const files = integrationTestCollections;
            return [
              `mkdir -p "${outDir}"`,
              ...files.map((f) => `cp "${path.join(integrationTestsRoot, f)}" "${path.join(outDir, f)}"`),
            ];
          },
        },
      },
      environment: {
        API_BASE_URL: httpApi.url ?? "",
      },
    });

    // Outputs
    new CfnOutput(this, "ApiUrl", {
      value: httpApi.url ?? "",
      description: `Financial Events API base URL (${stage})`,
      exportName: `FinancialEventsApiUrl-${stage}`,
    });

    new CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: `Cognito User Pool ID (${stage})`,
      exportName: `FinancialEventsCognitoUserPoolId-${stage}`,
    });

    new CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
      description: `Cognito User Pool Client ID (${stage})`,
      exportName: `FinancialEventsCognitoClientId-${stage}`,
    });

    new CfnOutput(this, "E2eRunnerFunctionName", {
      value: e2eRunnerFunction.functionName,
      description: `E2E Newman runner Lambda name (${stage})`,
      exportName: `FinancialEventsE2eRunnerFunctionName-${stage}`,
    });
  }
}
