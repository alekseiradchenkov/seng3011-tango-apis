/**
 * AWS Cognito authentication: signup, login, and logout via admin-level API calls
 * (`MessageAction: SUPPRESS` + `AdminSetUserPassword`) so users need not verify email before login.
 * Works against real Cognito or the LocalStack Cognito emulator.
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * Resolves the Cognito endpoint URL.
 * @returns LocalStack URL when `AWS_ENDPOINT_URL` / `LOCALSTACK_HOSTNAME` is set; otherwise `undefined` for regional AWS.
 */
function getCognitoEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

/**
 * Builds a {@link CognitoIdentityProviderClient} for the current environment.
 */
function getCognitoClient() {
  const endpoint = getCognitoEndpoint();
  return new CognitoIdentityProviderClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    ...(endpoint ? { endpoint } : {}),
  });
}

/**
 * Reads a required environment variable.
 * @param name - Variable name (e.g. `COGNITO_USER_POOL_ID`).
 * @returns The non-empty value.
 * @throws Error if the variable is missing or empty.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
const clientId = requireEnv("COGNITO_CLIENT_ID");

/**
 * Registers a user with `AdminCreateUser` + permanent `AdminSetUserPassword` (no verification email).
 *
 * @param email - Username and email attribute.
 * @param password - Permanent password (must satisfy pool policy).
 * @throws Cognito `UsernameExistsException` when the email is already registered.
 */
export async function signup(email: string, password: string) {
  const client = getCognitoClient();

  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [{ Name: "email", Value: email }],
      MessageAction: "SUPPRESS",
    }),
  );

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}

/**
 * Authenticates with `ADMIN_USER_PASSWORD_AUTH` and returns token fields for API clients.
 *
 * @param email - Username.
 * @param password - User password.
 * @returns Access, ID, and refresh tokens plus metadata.
 * @throws Error if Cognito returns no `AccessToken`.
 */
export async function login(email: string, password: string) {
  const client = getCognitoClient();

  const out = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  );

  const r = out.AuthenticationResult;
  if (!r || !r.AccessToken) {
    throw new Error("Missing AuthenticationResult / AccessToken");
  }

  return {
    accessToken: r.AccessToken,
    idToken: r.IdToken,
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn,
    tokenType: r.TokenType,
  };
}

/**
 * Global sign-out: invalidates the given access token on Cognito.
 *
 * @param accessToken - Bearer token from {@link login}.
 */
export async function logout(accessToken: string) {
  const client = getCognitoClient();
  await client.send(
    new GlobalSignOutCommand({
      AccessToken: accessToken,
    }),
  );
}
