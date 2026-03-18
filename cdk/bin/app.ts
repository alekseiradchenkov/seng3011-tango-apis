#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FinancialEventsStack } from "../lib/financial-events-stack";

const app = new cdk.App();

new FinancialEventsStack(app, "FinancialEventsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2"
  }
});

