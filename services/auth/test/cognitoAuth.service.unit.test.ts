/**
 * Unit tests for cognitoAuth.service with mocked Cognito SDK.
 */

const sendMock = jest.fn();

jest.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(function MockClient(this: { send: typeof sendMock }) {
    this.send = sendMock;
    return this;
  }),
  AdminCreateUserCommand: class AdminCreateUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  AdminDeleteUserCommand: class AdminDeleteUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  AdminSetUserPasswordCommand: class AdminSetUserPasswordCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  AdminInitiateAuthCommand: class AdminInitiateAuthCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GlobalSignOutCommand: class GlobalSignOutCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_CLIENT_ID = "test-client";

import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { login, logout, signup } from "../src/services/cognitoAuth.service";

describe("cognitoAuth.service", () => {
  beforeEach(() => {
    sendMock.mockReset();
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.LOCALSTACK_HOSTNAME;
  });

  it("signup sends AdminCreateUser and AdminSetUserPassword", async () => {
    sendMock.mockResolvedValue({});
    await signup("u@test.com", "Secret123!");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("signup deletes the created user when setting password fails", async () => {
    const err = Object.assign(new Error("Password does not conform to policy"), {
      name: "InvalidPasswordException",
    });
    sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(err).mockResolvedValueOnce({});

    await expect(signup("u@test.com", "weak")).rejects.toThrow(/Password does not conform/);
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[2][0].constructor.name).toBe("AdminDeleteUserCommand");
  });

  it("signup preserves the password error even if rollback delete fails", async () => {
    const passwordErr = Object.assign(new Error("Password does not conform to policy"), {
      name: "InvalidPasswordException",
    });
    sendMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(passwordErr)
      .mockRejectedValueOnce(new Error("delete failed"));

    await expect(signup("u@test.com", "weak")).rejects.toThrow(/Password does not conform/);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("login returns tokens", async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        AccessToken: "at",
        IdToken: "id",
        RefreshToken: "rt",
        ExpiresIn: 3600,
        TokenType: "Bearer",
      },
    });
    const tokens = await login("u@test.com", "pw");
    expect(tokens.accessToken).toBe("at");
    expect(tokens.idToken).toBe("id");
  });

  it("login throws when AuthenticationResult missing", async () => {
    sendMock.mockResolvedValue({ AuthenticationResult: null });
    await expect(login("u@test.com", "pw")).rejects.toThrow(/Missing AuthenticationResult/);
  });

  it("logout sends GlobalSignOut", async () => {
    sendMock.mockResolvedValue({});
    await logout("access-token");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("uses AWS_ENDPOINT_URL for client when set", async () => {
    process.env.AWS_ENDPOINT_URL = "http://localstack:4566";
    (CognitoIdentityProviderClient as unknown as jest.Mock).mockClear();
    sendMock.mockResolvedValue({});
    await signup("x@test.com", "pw");
    expect(CognitoIdentityProviderClient).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://localstack:4566" }),
    );
  });

  it("uses LOCALSTACK_HOSTNAME when endpoint not set", async () => {
    delete process.env.AWS_ENDPOINT_URL;
    process.env.LOCALSTACK_HOSTNAME = "ls";
    (CognitoIdentityProviderClient as unknown as jest.Mock).mockClear();
    sendMock.mockResolvedValue({});
    await logout("t");
    expect(CognitoIdentityProviderClient).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://ls:4566" }),
    );
  });
});
