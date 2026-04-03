#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FinancialEventsStack } from "../lib/financial-events-stack";

/**
 * CDK app entrypoint: synthesises {@link FinancialEventsStack} for the given stage.
 * `stage` is read from `cdk.context.json` / `--context stage=...` and defaults to `dev`.
 */
const app = new cdk.App();

const stage = app.node.tryGetContext("stage") || "dev";

new FinancialEventsStack(app, `FinancialEventsStack-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2",
  },
});

