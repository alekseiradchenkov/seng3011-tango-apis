import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

/** Lambda handler for Retrieval. */
export const handler = serverlessExpress({ app });

