import { attemptTokenSchema, startCallBodySchema, checkCallBodySchema } from './auth.ts'

test('requires an opaque 256-bit attempt token, never a phone number or OTP', () => {
  expect(attemptTokenSchema.safeParse('A'.repeat(43)).success).toBe(true)
  for (const value of ['1234', '+79991234567', 'provider-check-id', 'A'.repeat(44), 1234, null])
    expect(attemptTokenSchema.safeParse(value).success).toBe(false)
})
test('requires explicit consent and rejects extra request fields', () => {
  expect(startCallBodySchema.safeParse({ phone: '+79991234567', consent: true }).success).toBe(true)
  expect(
    checkCallBodySchema.safeParse({ attemptToken: 'A'.repeat(43), consent: true }).success,
  ).toBe(true)
  for (const body of [
    { phone: '+79991234567' },
    { phone: '+79991234567', consent: false },
    { phone: '+79991234567', consent: true, code: '1234' },
  ])
    expect(startCallBodySchema.safeParse(body).success).toBe(false)
  for (const body of [
    { attemptToken: 'A'.repeat(43) },
    { attemptToken: 'A'.repeat(43), consent: true, verified: true },
    { phone: '+79991234567', consent: true },
  ])
    expect(checkCallBodySchema.safeParse(body).success).toBe(false)
})
