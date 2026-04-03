import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

/** Lambda handler for the Collection Express app. */
export const handler = serverlessExpress({ app });

