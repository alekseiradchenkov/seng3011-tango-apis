#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FinancialEventsStack } from "../lib/financial-events-stack";

const app = new cdk.App();

const stage = app.node.tryGetContext("stage") || "dev";

new FinancialEventsStack(app, `FinancialEventsStack-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2"
  }
});

