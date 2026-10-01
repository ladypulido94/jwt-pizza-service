const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testAdminAuthToken;
let registerUserId;
let adminUserId;
let franchise;

const { Role, DB } = require("../database/database.js");

async function createAdminUser() {
  let user = { password: "toomanysecrets", roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + "@admin.com";

  user = await DB.addUser(user);
  return { ...user, password: "toomanysecrets" };
}

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  expect(registerRes.status).toBe(200);
  registerUserId = registerRes.body.user.id;
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
  expect(registerRes.status).toBe(200);

  const adminUser = await createAdminUser();
  adminUserId = adminUser.id;
  const loginRes = await request(app).put("/api/auth").send(adminUser);
  testAdminAuthToken = loginRes.body.token;
  expectValidJwt(testAdminAuthToken);
  expect(loginRes.status).toBe(200);
});

beforeEach(async () => {
  const createFranchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: testUser.email }] });
  expect(createFranchiseRes.status).toBe(200);
  franchise = createFranchiseRes.body;
});

afterEach(async () => {
  if (franchise) {
    await DB.deleteFranchise(franchise.id);
    franchise = undefined;
  }
});

test("get franchises", async () => {
  const getFranchisesRes = await request(app)
    .get("/api/franchise")
    .query({ name: franchise.name });
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body.franchises).toEqual([
    { id: franchise.id, name: franchise.name, stores: [] },
  ]);
  expect(getFranchisesRes.body.more).toBe(false);
});

test("get franchises as an admin", async () => {
  const getFranchisesRes = await request(app)
    .get("/api/franchise")
    .query({ name: franchise.name })
    .set("Authorization", `Bearer ${testAdminAuthToken}`);
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body.franchises).toHaveLength(1);
  expect(getFranchisesRes.body.franchises[0]).toMatchObject(franchise);
  expect(getFranchisesRes.body.more).toBe(false);
});

test("get user franchises", async () => {
  const getFranchisesRes = await request(app)
    .get(`/api/franchise/${registerUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body).toHaveLength(1);
  expect(getFranchisesRes.body[0]).toMatchObject(franchise);
});

test("get another user's franchises as an admin", async () => {
  const getFranchisesRes = await request(app)
    .get(`/api/franchise/${registerUserId}`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`);
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body[0]).toMatchObject(franchise);
});

test("get another user's franchises without permission", async () => {
  const getFranchisesRes = await request(app)
    .get(`/api/franchise/${adminUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body).toEqual([]);
});

test("get user franchises without a token", async () => {
  const getFranchisesRes = await request(app)
    .get(`/api/franchise/${registerUserId}`);
  expect(getFranchisesRes.status).toBe(401);
  expect(getFranchisesRes.body.message).toBe("unauthorized");
});

test("create franchise", async () => {
  const newFranchise = { name: randomName(), admins: [{ email: testUser.email }] };
  const createFranchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send(newFranchise);
  try {
    expect(createFranchiseRes.status).toBe(200);
    expect(createFranchiseRes.body.id).toEqual(expect.any(Number));
    expect(createFranchiseRes.body.name).toBe(newFranchise.name);
    expect(createFranchiseRes.body.admins).toEqual([
      { id: registerUserId, name: testUser.name, email: testUser.email },
    ]);
  } finally {
    if (createFranchiseRes.body.id) {
      await DB.deleteFranchise(createFranchiseRes.body.id);
    }
  }
});

test("create franchise without admin permission", async () => {
  const createFranchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: randomName(), admins: [] });
  expect(createFranchiseRes.status).toBe(403);
  expect(createFranchiseRes.body.message).toBe("unable to create a franchise");
});

test("create franchise with an unknown owner", async () => {
  const email = randomName() + "@test.com";
  const createFranchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send({ name: randomName(), admins: [{ email }] });
  expect(createFranchiseRes.status).toBe(404);
  expect(createFranchiseRes.body.message).toBe(
    `unknown user for franchise admin ${email} provided`,
  );
});

test("delete franchise", async () => {
  const deleteFranchiseRes = await request(app)
    .delete(`/api/franchise/${franchise.id}`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`);
  expect(deleteFranchiseRes.status).toBe(200);
  expect(deleteFranchiseRes.body.message).toBe("franchise deleted");

  const getFranchisesRes = await request(app)
    .get("/api/franchise")
    .query({ name: franchise.name });
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body.franchises).toEqual([]);
});

test("create store as an admin", async () => {
  const store = { name: randomName() };
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send(store);
  expect(createStoreRes.status).toBe(200);
  expect(createStoreRes.body).toMatchObject({
    id: expect.any(Number), franchiseId: franchise.id, name: store.name,
  });
});

test("create store as the franchise owner", async () => {
  const store = { name: randomName() };
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(store);
  expect(createStoreRes.status).toBe(200);
  expect(createStoreRes.body.name).toBe(store.name);
  expect(createStoreRes.body.franchiseId).toBe(franchise.id);
});

test("create store without franchise permission", async () => {
  const user = { name: randomName(), email: randomName() + "@test.com", password: "a" };
  const registerRes = await request(app).post("/api/auth").send(user);
  expect(registerRes.status).toBe(200);
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${registerRes.body.token}`)
    .send({ name: randomName() });
  expect(createStoreRes.status).toBe(403);
  expect(createStoreRes.body.message).toBe("unable to create a store");
});

test("delete store as an admin", async () => {
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send({ name: randomName() });
  expect(createStoreRes.status).toBe(200);
  const deleteStoreRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${createStoreRes.body.id}`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`);
  expect(deleteStoreRes.status).toBe(200);
  expect(deleteStoreRes.body.message).toBe("store deleted");

  const getFranchisesRes = await request(app)
    .get("/api/franchise")
    .query({ name: franchise.name });
  expect(getFranchisesRes.status).toBe(200);
  expect(getFranchisesRes.body.franchises[0].stores).toEqual([]);
});

test("delete store as the franchise owner", async () => {
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: randomName() });
  expect(createStoreRes.status).toBe(200);
  const deleteStoreRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${createStoreRes.body.id}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(deleteStoreRes.status).toBe(200);
  expect(deleteStoreRes.body.message).toBe("store deleted");
});

test("delete store without franchise permission", async () => {
  const user = { name: randomName(), email: randomName() + "@test.com", password: "a" };
  const registerRes = await request(app).post("/api/auth").send(user);
  expect(registerRes.status).toBe(200);
  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send({ name: randomName() });
  expect(createStoreRes.status).toBe(200);
  const deleteStoreRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${createStoreRes.body.id}`)
    .set("Authorization", `Bearer ${registerRes.body.token}`);
  expect(deleteStoreRes.status).toBe(403);
  expect(deleteStoreRes.body.message).toBe("unable to delete a store");
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}
