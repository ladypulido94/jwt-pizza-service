const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");
const config = require("../config.js");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testAdminAuthToken;
let registerUserId;
let franchise;
let store;
let menuItem;
let factoryRequest;
const menuItemIds = [];

beforeAll(async () => {
  testUser.email = randomName() + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  expect(registerRes.status).toBe(200);
  registerUserId = registerRes.body.user.id;
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  const adminUser = await createAdminUser();
  const loginRes = await request(app).put("/api/auth").send(adminUser);
  expect(loginRes.status).toBe(200);
  testAdminAuthToken = loginRes.body.token;
  expectValidJwt(testAdminAuthToken);

  franchise = await DB.createFranchise({ name: randomName(), admins: [] });
  store = await DB.createStore(franchise.id, { name: randomName() });
  menuItem = await DB.addMenuItem({
    title: randomName(), description: "Test pizza", image: "pizza.png", price: 0.01,
  });
  menuItemIds.push(menuItem.id);
});

beforeEach(() => {
  // Keep MySQL real, but control the external factory's HTTP response.
  factoryRequest = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ jwt: "test-pizza-jwt", reportUrl: "https://example.com/report" }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  // Remove only this suite's orders and menu items, children before parents.
  if (registerUserId) {
    const connection = await DB.getConnection();
    try {
      await connection.execute(
        "DELETE oi FROM orderItem oi JOIN dinerOrder d ON d.id=oi.orderId WHERE d.dinerId=?",
        [registerUserId],
      );
      await connection.execute("DELETE FROM dinerOrder WHERE dinerId=?", [registerUserId]);
      for (const id of menuItemIds) {
        await connection.execute("DELETE FROM menu WHERE id=?", [id]);
      }
    } finally {
      await connection.end();
    }
  }
  if (franchise) await DB.deleteFranchise(franchise.id);
});

test("get menu", async () => {
  const getMenuRes = await request(app).get("/api/order/menu");
  expect(getMenuRes.status).toBe(200);
  const item = getMenuRes.body.find((item) => item.id === menuItem.id);
  expect(item).toMatchObject({ title: menuItem.title, description: menuItem.description, image: menuItem.image });
  expect(Number(item.price)).toBe(menuItem.price);
});

test("add menu item as an admin", async () => {
  const newItem = { title: randomName(), description: "Cheese pizza", image: "cheese.png", price: 0.02 };
  const addMenuItemRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${testAdminAuthToken}`)
    .send(newItem);
  expect(addMenuItemRes.status).toBe(200);
  const item = addMenuItemRes.body.find((item) => item.title === newItem.title);
  expect(item).toBeDefined();
  menuItemIds.push(item.id);
  expect(item).toMatchObject({ title: newItem.title, description: newItem.description, image: newItem.image });
  expect(Number(item.price)).toBe(newItem.price);
});

test("add menu item without admin permission", async () => {
  const addMenuItemRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ title: randomName(), description: "Pizza", image: "pizza.png", price: 0.01 });
  expect(addMenuItemRes.status).toBe(403);
  expect(addMenuItemRes.body.message).toBe("unable to add menu item");
});

test("add menu item without a token", async () => {
  const addMenuItemRes = await request(app).put("/api/order/menu").send({});
  expect(addMenuItemRes.status).toBe(401);
  expect(addMenuItemRes.body.message).toBe("unauthorized");
});

test("get orders for a user with no orders", async () => {
  const user = { name: randomName(), email: randomName() + "@test.com", password: "a" };
  const registerRes = await request(app).post("/api/auth").send(user);
  expect(registerRes.status).toBe(200);
  const getOrdersRes = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${registerRes.body.token}`);
  expect(getOrdersRes.status).toBe(200);
  expect(getOrdersRes.body).toEqual({ dinerId: registerRes.body.user.id, orders: [], page: 1 });
});

test("get orders without a token", async () => {
  const getOrdersRes = await request(app).get("/api/order");
  expect(getOrdersRes.status).toBe(401);
  expect(getOrdersRes.body.message).toBe("unauthorized");
});

test("create order and get the saved order", async () => {
  const order = {
    franchiseId: franchise.id, storeId: store.id,
    items: [{ menuId: menuItem.id, description: menuItem.description, price: menuItem.price }],
  };
  const createOrderRes = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(order);
  expect(createOrderRes.status).toBe(200);
  expect(createOrderRes.body.order).toMatchObject(order);
  expect(createOrderRes.body.order.id).toEqual(expect.any(Number));
  expect(createOrderRes.body.jwt).toBe("test-pizza-jwt");
  expect(createOrderRes.body.followLinkToEndChaos).toBe("https://example.com/report");
  expect(factoryRequest).toHaveBeenCalledTimes(1);
  // Do not include the API key in assertions or test output.
  expect(factoryRequest.mock.calls[0][0]).toBe(`${config.factory.url}/api/order`);
  const factoryOptions = factoryRequest.mock.calls[0][1];
  expect(factoryOptions.method).toBe("POST");
  expect(JSON.parse(factoryOptions.body)).toEqual({
    diner: { id: registerUserId, name: testUser.name, email: testUser.email },
    order: createOrderRes.body.order,
  });

  const getOrdersRes = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(getOrdersRes.status).toBe(200);
  expect(getOrdersRes.body.dinerId).toBe(registerUserId);
  const savedOrder = getOrdersRes.body.orders.find((item) => item.id === createOrderRes.body.order.id);
  expect(savedOrder).toMatchObject({ franchiseId: franchise.id, storeId: store.id });
  expect(savedOrder.items).toHaveLength(1);
  expect(savedOrder.items[0].menuId).toBe(menuItem.id);
  expect(savedOrder.items[0].description).toBe(menuItem.description);
  expect(Number(savedOrder.items[0].price)).toBe(menuItem.price);
});

test("create order when the factory rejects it", async () => {
  factoryRequest.mockResolvedValue({
    ok: false,
    json: async () => ({ reportUrl: "https://example.com/failure" }),
  });
  const order = {
    franchiseId: franchise.id, storeId: store.id,
    items: [{ menuId: menuItem.id, description: menuItem.description, price: menuItem.price }],
  };
  const createOrderRes = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(order);
  expect(createOrderRes.status).toBe(500);
  expect(createOrderRes.body.message).toBe("Failed to fulfill order at factory");
  expect(createOrderRes.body.followLinkToEndChaos).toBe("https://example.com/failure");
  expect(createOrderRes.body).not.toHaveProperty("jwt");
  expect(factoryRequest).toHaveBeenCalledTimes(1);
});

test("create order without a token", async () => {
  const createOrderRes = await request(app).post("/api/order").send({});
  expect(createOrderRes.status).toBe(401);
  expect(createOrderRes.body.message).toBe("unauthorized");
  expect(factoryRequest).not.toHaveBeenCalled();
});

async function createAdminUser() {
  let user = { name: randomName(), password: "toomanysecrets", roles: [{ role: Role.Admin }] };
  user.email = user.name + "@admin.com";
  user = await DB.addUser(user);
  return { ...user, password: "toomanysecrets" };
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}
