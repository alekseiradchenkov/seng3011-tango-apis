import serverlessExpress from "@vendia/serverless-express";
import { app } from "./server";

export const handler = serverlessExpress({ app });

