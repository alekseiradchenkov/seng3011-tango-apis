import { Router, Request, Response } from "express";
import { signup, login, logout } from "../services/cognitoAuth.service";

const router = Router();

router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "email and password are required",
      });
      return;
    }

    await signup(email, password);
    res.status(201).json({ status: "ok" });
  } catch (err: unknown) {
    const code = (err as { name?: string; __type?: string })?.name ?? (err as { __type?: string })?.__type;
    if (code === "UsernameExistsException") {
      res.status(409).json({
        error: "USER_ALREADY_EXISTS",
        message: "A user with this email already exists.",
      });
      return;
    }

    res.status(500).json({
      error: "AUTH_SIGNUP_FAILED",
      message: String((err as { message?: string })?.message ?? err),
    });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "email and password are required",
      });
      return;
    }

    const tokens = await login(email, password);
    res.status(200).json(tokens);
  } catch (err: unknown) {
    res.status(401).json({
      error: "AUTH_LOGIN_FAILED",
      message: String((err as { message?: string })?.message ?? err),
    });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    const token =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice(7)
        : (req.body?.accessToken as string | undefined);

    if (!token) {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "accessToken is required (Authorization header or body)",
      });
      return;
    }

    await logout(token);
    res.status(200).json({ status: "ok" });
  } catch (err: unknown) {
    res.status(500).json({
      error: "AUTH_LOGOUT_FAILED",
      message: String((err as { message?: string })?.message ?? err),
    });
  }
});

export default router;

