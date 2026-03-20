import * as path from "path";
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

interface FinancialEventsStackProps extends StackProps {
  stage?: string;
}

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
      runtime: Runtime.NODEJS_20_X,
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
      runtime: Runtime.NODEJS_20_X,
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
      runtime: Runtime.NODEJS_20_X,
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

    // Auth Lambda
    const authFunction = new NodejsFunction(this, "AuthFunction", {
      entry: path.join(__dirname, "..", "..", "services", "auth", "src", "lambda.ts"),
      depsLockFilePath: path.join(__dirname, "..", "..", "services", "auth", "package-lock.json"),
      runtime: Runtime.NODEJS_20_X,
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
      runtime: Runtime.NODEJS_20_X,
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

    eventsBucket.grantReadWrite(collectionFunction);
    eventsBucket.grantRead(retrievalFunction);
    eventsBucket.grantRead(visualisationFunction);

    // HTTP API
    const httpApi = new apigw.HttpApi(this, "FinancialEventsApi", {
      apiName: `financial-events-api-${stage}`,
    });

    const collectionIntegration = new apigwIntegrations.HttpLambdaIntegration("CollectionIntegration", collectionFunction);
    const retrievalIntegration = new apigwIntegrations.HttpLambdaIntegration("RetrievalIntegration", retrievalFunction);
    const visualisationIntegration = new apigwIntegrations.HttpLambdaIntegration("VisualisationIntegration", visualisationFunction);
    const authIntegration = new apigwIntegrations.HttpLambdaIntegration("AuthIntegration", authFunction);
    const docsIntegration = new apigwIntegrations.HttpLambdaIntegration("DocsIntegration", docsFunction);

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
  }
}
