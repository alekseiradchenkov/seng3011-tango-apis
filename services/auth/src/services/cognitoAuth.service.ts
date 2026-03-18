import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";

function getCognitoEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

function getCognitoClient() {
  const endpoint = getCognitoEndpoint();
  return new CognitoIdentityProviderClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    ...(endpoint ? { endpoint } : {}),
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
const clientId = requireEnv("COGNITO_CLIENT_ID");

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

export async function logout(accessToken: string) {
  const client = getCognitoClient();
  await client.send(
    new GlobalSignOutCommand({
      AccessToken: accessToken,
    }),
  );
}

