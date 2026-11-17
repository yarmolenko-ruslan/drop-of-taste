function hasControls(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}

/** Browser URL parsing strips control characters and treats backslashes as slashes. */
export function isInternalPath(value: string) {
  return (
    value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !hasControls(value)
  )
}

export function isHttpsUrl(value: string) {
  if (!value.startsWith('https://') || hasControls(value) || value.includes('\\')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
