import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

/** Lambda handler for Visualisation. */
export const handler = serverlessExpress({ app });

