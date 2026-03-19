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

export class FinancialEventsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Always deploy a single stack; redeploys update it in place.
    // Stateful resources are retained on stack delete by default.
    const retentionPolicy = RemovalPolicy.RETAIN;

    // Local auth bypass can be toggled via env if needed; default is disabled so
    // production/AWS uses full Cognito auth unless explicitly overridden.
    const allowAuthBypass = ["1", "true"].includes(
      (process.env.AUTH_BYPASS ?? "").toLowerCase().trim(),
    );

    // Cognito User Pool + Client (shared for all Lambdas)
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

    // DynamoDB tables
    const eventIndexTable = new dynamodb.Table(this, "EventIndexTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retentionPolicy,
    });

    const chartsTable = new dynamodb.Table(this, "ChartsTable", {
      partitionKey: { name: "chart_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retentionPolicy,
    });

    // S3 buckets
    const rawBucket = new s3.Bucket(this, "RawPriceDataBucket", {
      removalPolicy: retentionPolicy,
    });

    const eventsBucket = new s3.Bucket(this, "EventDatasetsBucket", {
      removalPolicy: retentionPolicy,
    });

    // Lambda functions (Express wrapped via @vendia/serverless-express)
    const collectionFunction = new NodejsFunction(this, "CollectionFunction", {
      entry: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "collection",
        "src",
        "lambda.ts"
      ),
      depsLockFilePath: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "collection",
        "package-lock.json"
      ),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: [
          "@vendia/serverless-express",
          "aws-jwt-verify",
          "cors",
          "express",
          "morgan",
          "swagger-ui-express",
          "yamljs",
        ],
        externalModules: ["@aws-sdk/*"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp \"${path.join(inputDir, "swagger.yaml")}\" \"${path.join(
              outputDir,
              "swagger.yaml"
            )}\"`,
          ],
        },
      },
      environment: {
        EVENT_INDEX_TABLE: eventIndexTable.tableName,
        EVENTS_BUCKET: eventsBucket.bucketName,
        RAW_BUCKET: rawBucket.bucketName,
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const retrievalFunction = new NodejsFunction(this, "RetrievalFunction", {
      entry: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "retrieval",
        "src",
        "lambda.ts"
      ),
      depsLockFilePath: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "retrieval",
        "package-lock.json"
      ),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: [
          "@vendia/serverless-express",
          "aws-jwt-verify",
          "cors",
          "express",
          "morgan",
          "swagger-ui-express",
          "yamljs",
        ],
        externalModules: ["@aws-sdk/*"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp \"${path.join(inputDir, "swagger.yaml")}\" \"${path.join(
              outputDir,
              "swagger.yaml"
            )}\"`,
          ],
        },
      },
      environment: {
        EVENT_INDEX_TABLE: eventIndexTable.tableName,
        EVENTS_BUCKET: eventsBucket.bucketName,
        ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const visualisationFunction = new NodejsFunction(
      this,
      "VisualisationFunction",
      {
        entry: path.join(
          __dirname,
          "..",
          "..",
          "services",
          "visualisation",
          "src",
          "lambda.ts"
        ),
        depsLockFilePath: path.join(
          __dirname,
          "..",
          "..",
          "services",
          "visualisation",
          "package-lock.json"
        ),
        runtime: Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        bundling: {
          nodeModules: [
            "@vendia/serverless-express",
            "aws-jwt-verify",
            "cors",
            "express",
            "morgan",
            "swagger-ui-express",
            "yamljs",
          ],
          externalModules: ["@aws-sdk/*"],
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (inputDir: string, outputDir: string) => [
              `cp \"${path.join(inputDir, "swagger.yaml")}\" \"${path.join(
                outputDir,
                "swagger.yaml"
              )}\"`,
            ],
          },
        },
        environment: {
          EVENT_INDEX_TABLE: eventIndexTable.tableName,
          EVENTS_BUCKET: eventsBucket.bucketName,
          CHARTS_TABLE: chartsTable.tableName,
          ...(allowAuthBypass ? { AUTH_BYPASS: "true" } : {}),
          COGNITO_USER_POOL_ID: userPool.userPoolId,
          COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        },
      }
    );

    const authFunction = new NodejsFunction(this, "AuthFunction", {
      entry: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "auth",
        "src",
        "lambda.ts",
      ),
      depsLockFilePath: path.join(
        __dirname,
        "..",
        "..",
        "services",
        "auth",
        "package-lock.json",
      ),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: [
          "@vendia/serverless-express",
          "cors",
          "express",
          "morgan",
          "swagger-ui-express",
          "yamljs",
        ],
        externalModules: ["@aws-sdk/*"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp \"${path.join(inputDir, "swagger.yaml")}\" \"${path.join(
              outputDir,
              "swagger.yaml"
            )}\"`,
          ],
        },
      },
      environment: {
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
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
    eventIndexTable.grantReadData(visualisationFunction);

    chartsTable.grantReadWriteData(visualisationFunction);

    rawBucket.grantReadWrite(collectionFunction);
    eventsBucket.grantReadWrite(collectionFunction);
    eventsBucket.grantRead(retrievalFunction);
    eventsBucket.grantRead(visualisationFunction);

    // HTTP API
    const httpApi = new apigw.HttpApi(this, "FinancialEventsApi", {
      apiName: "financial-events-api",
    });

    const collectionIntegration = new apigwIntegrations.HttpLambdaIntegration(
      "CollectionIntegration",
      collectionFunction
    );
    const retrievalIntegration = new apigwIntegrations.HttpLambdaIntegration(
      "RetrievalIntegration",
      retrievalFunction
    );
    const visualisationIntegration =
      new apigwIntegrations.HttpLambdaIntegration(
        "VisualisationIntegration",
        visualisationFunction
      );

    const authIntegration = new apigwIntegrations.HttpLambdaIntegration(
      "AuthIntegration",
      authFunction,
    );

    // Public swagger docs & status — no auth required
    for (const [svc, integration] of [
      ["collection", collectionIntegration],
      ["retrieval", retrievalIntegration],
      ["visualisation", visualisationIntegration],
    ] as const) {
      // Serves the swagger HTML page
      httpApi.addRoutes({
        path: `/v0/${svc}/docs`,
        methods: [apigw.HttpMethod.GET],
        integration,
      });
      // Serves swagger-ui static assets (CSS/JS) loaded by the HTML page
      httpApi.addRoutes({
        path: `/v0/${svc}/docs/{proxy+}`,
        methods: [apigw.HttpMethod.GET],
        integration,
      });
      httpApi.addRoutes({
        path: `/v0/${svc}/status`,
        methods: [apigw.HttpMethod.GET],
        integration,
      });
    }

    // Collection routes
    httpApi.addRoutes({
      path: "/v1/datasets",
      methods: [apigw.HttpMethod.POST],
      integration: collectionIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}",
      methods: [apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],
      integration: collectionIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}/events/fetch",
      methods: [apigw.HttpMethod.POST],
      integration: collectionIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}/events/remove",
      methods: [apigw.HttpMethod.DELETE],
      integration: collectionIntegration,
    });

    // Retrieval routes
    httpApi.addRoutes({
      path: "/v1/datasets",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}/events",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}/events/stats",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/datasets/{datasetId}/export",
      methods: [apigw.HttpMethod.GET],
      integration: retrievalIntegration,
    });

    // Visualisation routes (prefix /v1)
    httpApi.addRoutes({
      path: "/v1/events/summary",
      methods: [apigw.HttpMethod.GET],
      integration: visualisationIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/events/trends",
      methods: [apigw.HttpMethod.GET],
      integration: visualisationIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/charts",
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
      integration: visualisationIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/charts/{chartId}",
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.DELETE],
      integration: visualisationIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/charts/{chartId}/render",
      methods: [apigw.HttpMethod.GET],
      integration: visualisationIntegration,
    });

    // Auth routes
    httpApi.addRoutes({
      path: "/v0/auth/docs",
      methods: [apigw.HttpMethod.GET],
      integration: authIntegration,
    });
    httpApi.addRoutes({
      path: "/v0/auth/docs/{proxy+}",
      methods: [apigw.HttpMethod.GET],
      integration: authIntegration,
    });
    httpApi.addRoutes({
      path: "/v0/auth/status",
      methods: [apigw.HttpMethod.GET],
      integration: authIntegration,
    });
    httpApi.addRoutes({
      path: "/v1/auth/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: authIntegration,
    });

    // Output the API URL so it is visible in the CDK deploy output and
    // in the CloudFormation console under the Outputs tab.
    new CfnOutput(this, "ApiUrl", {
      value: httpApi.url ?? "",
      description: "Financial Events API base URL",
      exportName: "FinancialEventsApiUrl",
    });

    new CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: "FinancialEventsCognitoUserPoolId",
    });

    new CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: "FinancialEventsCognitoClientId",
    });
  }
}

