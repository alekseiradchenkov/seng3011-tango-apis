import type { Request } from "express";

/** Express 5 `Request` is generic; intersection avoids `extends` incompatibilities with `asyncHandler`. */
export type AuthRequest = Request & { userId: string };
