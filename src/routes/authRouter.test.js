const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

jest.mock("../database/database.js", () => ({
  DB: {
    addUser: jest.fn(),
    getUser: jest.fn(),
    loginUser: jest.fn(),
    logoutUser: jest.fn(),
    isLoggedIn: jest.fn(),
  },
  Role: { Diner: "diner" },
}));
jest.mock("../config.js", () => ({ jwtSecret: "auth-router-test-secret" }));

const { DB } = require("../database/database.js");
const config = require("../config.js");
const { authRouter, setAuthUser } = require("./authRouter.js");

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use("/api/auth", authRouter);
// eslint-disable-next-line no-unused-vars -- Express requires four parameters to identify error middleware.
app.use((err, req, res, next) => {
  res.status(err.statusCode || 500).json({ message: err.message });
});

const credentials = {
  name: "pizza diner",
  email: "reg@test.com",
  password: "a",
};
const user = {
  id: 1,
  name: credentials.name,
  email: credentials.email,
  roles: [{ role: "diner" }],
};

beforeEach(() => {
  jest.resetAllMocks();
  DB.addUser.mockResolvedValue(user);
  DB.getUser.mockResolvedValue(user);
  DB.loginUser.mockResolvedValue(undefined);
  DB.logoutUser.mockResolvedValue(undefined);
  DB.isLoggedIn.mockResolvedValue(false);
});

function expectAuthentication(response) {
  expect(response.status).toBe(200);
  expect(response.body.user).toEqual(user);
  expect(response.body.user).not.toHaveProperty("password");
  expect(jwt.verify(response.body.token, config.jwtSecret)).toMatchObject(user);
  expect(DB.loginUser).toHaveBeenCalledWith(user.id, response.body.token);
}

test("registers a diner and stores the signed token", async () => {
  const response = await request(app).post("/api/auth").send(credentials);
  expectAuthentication(response);
  expect(DB.addUser).toHaveBeenCalledWith({
    ...credentials,
    roles: [{ role: "diner" }],
  });
});

test.each(["name", "email", "password"])(
  "rejects registration without %s",
  async (field) => {
    const body = { ...credentials };
    delete body[field];
    const response = await request(app).post("/api/auth").send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "name, email, and password are required",
    });
    expect(DB.addUser).not.toHaveBeenCalled();
    expect(DB.loginUser).not.toHaveBeenCalled();
  },
);

test("logs in an existing user and stores the signed token", async () => {
  const response = await request(app).put("/api/auth").send(credentials);
  expectAuthentication(response);
  expect(DB.getUser).toHaveBeenCalledWith(
    credentials.email,
    credentials.password,
  );
});

test.each([
  ["post", "addUser"],
  ["put", "getUser"],
  ["post", "loginUser"],
  ["put", "loginUser"],
])("%s forwards a failure from %s", async (method, operation) => {
  DB[operation].mockRejectedValue(new Error("database unavailable"));
  const response = await request(app)[method]("/api/auth").send(credentials);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ message: "database unavailable" });
});

test("returns the status of rejected credentials", async () => {
  DB.getUser.mockRejectedValue(
    Object.assign(new Error("unknown user"), { statusCode: 404 }),
  );
  const response = await request(app).put("/api/auth").send(credentials);
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ message: "unknown user" });
  expect(DB.loginUser).not.toHaveBeenCalled();
});

test("logs out an authenticated user", async () => {
  const token = jwt.sign(user, config.jwtSecret);
  DB.isLoggedIn.mockResolvedValue(true);
  const response = await request(app)
    .delete("/api/auth")
    .set("Authorization", `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: "logout successful" });
  expect(DB.isLoggedIn).toHaveBeenCalledWith(token);
  expect(DB.logoutUser).toHaveBeenCalledWith(token);
});

test.each([
  ["no authorization header", undefined, false],
  ["a header without a token", "Bearer", false],
  ["a revoked token", "Bearer revoked", false],
  ["a malformed token", "Bearer invalid", true],
  [
    "an expired token",
    `Bearer ${jwt.sign(user, config.jwtSecret, { expiresIn: -1 })}`,
    true,
  ],
  ["an invalid signature", `Bearer ${jwt.sign(user, "wrong-secret")}`, true],
])("rejects logout with %s", async (description, header, loggedIn) => {
  DB.isLoggedIn.mockResolvedValue(loggedIn);
  const pending = request(app).delete("/api/auth");
  if (header) pending.set("Authorization", header);
  const response = await pending;
  expect(response.status).toBe(401);
  expect(response.body).toEqual({ message: "unauthorized" });
  expect(DB.logoutUser).not.toHaveBeenCalled();
});

test("treats a failed session lookup as unauthenticated", async () => {
  DB.isLoggedIn.mockRejectedValue(new Error("database unavailable"));
  const response = await request(app)
    .delete("/api/auth")
    .set("Authorization", "Bearer token");
  expect(response.status).toBe(401);
  expect(DB.logoutUser).not.toHaveBeenCalled();
});

test("forwards logout database failures", async () => {
  DB.isLoggedIn.mockResolvedValue(true);
  DB.logoutUser.mockRejectedValue(new Error("logout failed"));
  const token = jwt.sign(user, config.jwtSecret);
  const response = await request(app)
    .delete("/api/auth")
    .set("Authorization", `Bearer ${token}`);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ message: "logout failed" });
});

test("attaches the verified user and checks matching and missing roles", async () => {
  DB.isLoggedIn.mockResolvedValue(true);
  const token = jwt.sign(user, config.jwtSecret);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const next = jest.fn();
  await setAuthUser(req, {}, next);
  expect(req.user).toMatchObject(user);
  expect(req.user.isRole("diner")).toBe(true);
  expect(req.user.isRole("admin")).toBe(false);
  expect(next).toHaveBeenCalledTimes(1);
});

test("clears the user and continues when token verification fails", async () => {
  DB.isLoggedIn.mockResolvedValue(true);
  const req = { headers: { authorization: "Bearer invalid" } };
  const next = jest.fn();
  await setAuthUser(req, {}, next);
  expect(req.user).toBeNull();
  expect(next).toHaveBeenCalledTimes(1);
});

test("allows logout when upstream middleware supplies a user without a token", async () => {
  // Exercise the defensive no-token path, which normal JWT authentication cannot reach.
  const upstreamApp = express();
  upstreamApp.use((req, res, next) => {
    req.user = user;
    next();
  });
  upstreamApp.use("/api/auth", authRouter);
  const response = await request(upstreamApp).delete("/api/auth");
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: "logout successful" });
  expect(DB.logoutUser).not.toHaveBeenCalled();
});
