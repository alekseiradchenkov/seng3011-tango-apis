import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

/** Lambda handler for Predictive. */
export const handler = serverlessExpress({ app });

