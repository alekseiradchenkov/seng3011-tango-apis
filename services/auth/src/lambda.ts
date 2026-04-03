import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

/** AWS Lambda handler for the Auth Express app (API Gateway + Lambda). */
export const handler = serverlessExpress({ app });

