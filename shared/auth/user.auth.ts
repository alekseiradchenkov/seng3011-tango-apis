import { CognitoJwtVerifier } from "aws-jwt-verify";
import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../../shared/types/auth.type";

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

/* Default cognito verifier from documentation. */
function getVerifier() {
  if (verifier) return verifier;

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error("Cognito auth variables not foound.");
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: "access",
  });

  return verifier;
}

export async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const jwtToken = auth.slice(7);

  try {
    const payload = await getVerifier().verify(jwtToken);

    /* cognito stores `user_id` as `sub` by default */
    if (payload.sub === undefined || payload.sub === null) return null;

    return payload.sub;
  } catch {
    return null;
  }
}

export async function checkAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!process.env.COGNITO_USER_POOL_ID || !process.env.COGNITO_CLIENT_ID) {
      res.status(500).json({
        error: "AUTH_ENV_NOT_FOUND",
        message: "Authirization environment variables are not set.",
      });
      return;
    }

    const userId = await getUserId(req);

    if (!userId) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Invalid authorization token.",
      });
      return;
    }

    (req as AuthRequest).userId = userId;

    next();
  } catch (error) {
    next(error);
  }
}