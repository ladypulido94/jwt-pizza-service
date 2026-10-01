const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let registerUserId;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  registerUserId = registerRes.body.user.id;
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test("get user", async () => {
  const getUserRes = await request(app)
    .get("/api/user/me")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(getUserRes.status).toBe(200);

  expect(getUserRes.body.name).toBe(testUser.name);
  expect(getUserRes.body.email).toBe(testUser.email);
});

test("update user", async () => {
  const updatedUser = {
    name: "pizza user",
    email: "user@test.com",
    password: "b",
  };
  updatedUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";

  const updateUserRes = await request(app)
    .put(`/api/user/${registerUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(updatedUser);
  expect(updateUserRes.status).toBe(200);

  expect(updateUserRes.body.user.name).toBe(updatedUser.name);
  expect(updateUserRes.body.user.email).toBe(updatedUser.email);
});

test("delete user", async () => {
  const deleteUserRes = await request(app)
    .delete(`/api/user/${registerUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(deleteUserRes.status).toBe(200);
  expect(deleteUserRes.body.message).toBe("not implemented");
});

test("list users", async () => {
  const listUsersRes = await request(app)
    .get("/api/user")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.message).toBe("not implemented");
  expect(listUsersRes.body.users).toEqual([]);
  expect(listUsersRes.body.more).toBe(false);
});

test("update another user without permission", async () => {
  const registerUser = { name: "Emily", email: "test@test.com", password: "b" };
  registerUser.email =
    Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(registerUser);
  expect(registerRes.status).toBe(200);
  const otherUserId = registerRes.body.user.id;

  const updatedUser = { ...registerUser, name: "changed name" };
  const updateUserRes = await request(app)
    .put(`/api/user/${otherUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(updatedUser);
  expect(updateUserRes.status).toBe(403);
  expect(updateUserRes.body.message).toBe("unauthorized");
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}
