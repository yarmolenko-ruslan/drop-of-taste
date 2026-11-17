import { isHttpsUrl, isInternalPath } from './urls.ts'

test('internal paths cannot become external URLs after browser normalization', () => {
  for (const value of ['/menu/soups', '/uploads/photo.png', '/promotions/birthday?x=1#details'])
    expect(isInternalPath(value)).toBe(true)
  for (const value of [
    '//attacker.invalid',
    '/\\attacker.invalid',
    '/\t/attacker.invalid',
    '/\n/attacker.invalid',
    '/\r/attacker.invalid',
    'javascript:alert(1)',
  ])
    expect(isInternalPath(value), JSON.stringify(value)).toBe(false)
})

test('image and map HTTPS URLs cannot contain embedded credentials or control characters', () => {
  expect(isHttpsUrl('https://images.example.invalid/photo.png')).toBe(true)
  for (const value of [
    'javascript:alert(1)',
    'http://attacker.invalid',
    'https://user:password@example.invalid/a',
    'https://example.invalid\n.attacker.invalid/a',
    'https://',
    'https://example.invalid\\@attacker.invalid',
  ])
    expect(isHttpsUrl(value), JSON.stringify(value)).toBe(false)
})
