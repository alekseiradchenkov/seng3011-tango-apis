// cognitoAuth.service.ts
 
// Handles all AWS Cognito authentication operations: signup, login, and logout.
// Uses admin-level Cognito API calls so users do not need to verify their email
// before logging in (MessageAction: SUPPRESS + AdminSetUserPassword).
// Supports both real AWS Cognito and the LocalStack Cognito emulator for local
// development and CI testing.

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Resolves the Cognito endpoint URL.
 // In production (real AWS): returns undefined so the SDK uses the default regional endpoint.
 // In LocalStack (local dev / CI): returns the LocalStack URL so Cognito calls are intercepted.
function getCognitoEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

 // Creates and returns a configured CognitoIdentityProviderClient.
 // Endpoint is injected at construction time so the same code works in
 // local, CI (LocalStack), and production (AWS) environments.
function getCognitoClient() {
  const endpoint = getCognitoEndpoint();
  return new CognitoIdentityProviderClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    ...(endpoint ? { endpoint } : {}),
  });
}

// Reads a required environment variable and throws a clear error if it is missing.
// Used to fail fast at startup rather than producing cryptic runtime errors later.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

// Read Cognito pool config once at module load time.
// These are set by the CDK stack as Lambda environment variables.
const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
const clientId = requireEnv("COGNITO_CLIENT_ID");



// Registers a new user in the Cognito User Pool.
  // Uses the admin flow (AdminCreateUser + AdminSetUserPassword) so:
  // No verification email is sent (MessageAction: SUPPRESS).
  // The password is set immediately as permanent

  // @param email    The user's email address (used as the Cognito username).
  // @param password The user's chosen password (must meet the pool's password policy).
  // @throws UsernameExistsException if a user with this email already exists.
export async function signup(email: string, password: string) {
  const client = getCognitoClient();

    // Step 1: Create the user record. SUPPRESS prevents Cognito sending a welcome email.
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [{ Name: "email", Value: email }],
      MessageAction: "SUPPRESS",
    }),
  );

  // Step 2: Set the permanent password immediately so the user can log in right away
  // without going through a forced password-change flow.
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}


// Authenticates a user and returns Cognito tokens.
  // Uses ADMIN_USER_PASSWORD_AUTH which requires the server-side admin credentials
  // and avoids the need for SRP (Secure Remote Password) on the client side.

  // @param email    The user's email address.
  // @param password The user's password.
  // @returns An object containing accessToken, idToken, refreshToken, expiresIn, tokenType.
  // @throws Error if Cognito does not return an AccessToken (e.g. wrong credentials).

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

  // Return only the token fields the API consumers need.
  return {
    accessToken: r.AccessToken,
    idToken: r.IdToken,
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn,
    tokenType: r.TokenType,
  };
}
// Signs out a user globally, invalidating all of their active Cognito sessions.
// Revokes the access token on the Cognito side so it cannot be reused.
// @param accessToken The user's current Cognito access token (from login).
export async function logout(accessToken: string) {
  const client = getCognitoClient();
  await client.send(
    new GlobalSignOutCommand({
      AccessToken: accessToken,
    }),
  );
}

