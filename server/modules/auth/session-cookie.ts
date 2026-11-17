export function sessionCookieName(secureCookies: boolean) {
  return secureCookies ? '__Host-session' : 'dev_session'
}

export function readSessionToken(header: string | undefined, secureCookies: boolean) {
  const name = sessionCookieName(secureCookies)
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
