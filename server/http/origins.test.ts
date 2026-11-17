// @vitest-environment node
import { createOriginChecker } from './origins.ts'

test('only explicitly configured full origins are accepted', () => {
  const allowed = createOriginChecker(['http://localhost:5173', 'http://127.0.0.1:5173'])
  expect(allowed('http://localhost:5173')).toBe(true)
  expect(allowed('http://127.0.0.1:5173')).toBe(true)
  for (const origin of [
    undefined,
    'null',
    'http://localhost:9000',
    'http://127.0.0.1:9000',
    'http://localhost:5173/evil',
    'http://user@localhost:5173',
    'http://localhost:5173.attacker.invalid',
    'https://localhost:5173',
  ])
    expect(allowed(origin), String(origin)).toBe(false)
})
