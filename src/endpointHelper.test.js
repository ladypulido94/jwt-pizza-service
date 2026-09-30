const { asyncHandler, StatusCodeError } = require('./endpointHelper.js');

test('StatusCodeError preserves the message, HTTP status, and Error behavior', () => {
  const error = new StatusCodeError('unknown user', 404);

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(StatusCodeError);
  expect(error.message).toBe('unknown user');
  expect(error.statusCode).toBe(404);
  expect(error.stack).toContain('unknown user');
});

test('asyncHandler passes request arguments and returns the resolved result', async () => {
  const req = { body: { name: 'pizza diner' } };
  const res = {};
  const next = jest.fn();
  const handler = jest.fn().mockResolvedValue('success');

  await expect(asyncHandler(handler)(req, res, next)).resolves.toBe('success');
  expect(handler).toHaveBeenCalledWith(req, res, next);
  expect(next).not.toHaveBeenCalled();
});

test('asyncHandler forwards a rejected error to Express', async () => {
  const error = new StatusCodeError('unknown user', 404);
  const next = jest.fn();
  const handler = jest.fn().mockRejectedValue(error);

  await asyncHandler(handler)({}, {}, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(error);
});
