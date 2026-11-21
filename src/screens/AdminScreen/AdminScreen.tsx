import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { apiRequest, ApiError, setAdminRequestIdentity } from '../../features/auth/api/authApi'
import type { SiteContent } from '../../../shared/site-content'
import type { Dashboard } from './adminTypes'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { OrdersEditor, ClientsEditor } from './AdminOperations'
import { LoadingState } from '../../shared/ui/LoadingState/LoadingState'
import { AdminTabs, type Tab } from './AdminTabs'
import { ContentEditor } from './ContentEditor'
import { LegalEditor } from './LegalEditor'
import { CategoriesEditor, ProductsEditor } from './CatalogEditors'
import { IikoEditor } from './IikoEditor'
import { BonusCodesEditor } from './BonusCodesEditor'
import { LogsEditor } from './LogsEditor'
import { errorMessage, completeAdminContent } from './adminUtils'
import styles from './AdminScreen.module.css'
import {
  can,
  type AdminPrincipal,
  type AdminSession,
  type Permission,
} from '../../../shared/admin-access'
import {
  pendingLogoutKey,
  readAdminLogout,
  parseAdminLogout,
  persistAdminLogout,
  completeAdminLogout,
} from '../../features/auth/api/adminLogoutState'
import { EmployeesEditor } from './EmployeesEditor'
import { PasswordEditor } from './PasswordEditor'

const tabPermissions: Partial<Record<Tab, Permission>> = {
  orders: 'orders.read',
  clients: 'clients.read',
  content: 'site.read',
  promotions: 'promotions.read',
  codes: 'codes.read',
  categories: 'catalog.read',
  products: 'catalog.read',
  legal: 'legal.read',
}
const allTabs: Tab[] = [
  'orders',
  'clients',
  'content',
  'promotions',
  'codes',
  'categories',
  'products',
  'legal',
  'logs',
  'iiko',
  'employees',
]

function hasPendingLogout() {
  return readAdminLogout() !== null
}

export function AdminScreen({ staffLogin = false }: { staffLogin?: boolean }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(() => !hasPendingLogout())
  const [logoutIntent, setLogoutIntent] = useState(readAdminLogout)
  const logoutPending = logoutIntent !== null
  const restoreAllowed = useRef(!logoutPending)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionEpoch = useRef(0)
  const mounted = useRef(true)
  const authenticatedRef = useRef(false)
  const [password, setPassword] = useState('')
  const [loginName, setLoginName] = useState('')
  const [principal, setPrincipal] = useState<AdminPrincipal | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const allowedTabs = useMemo(
    () =>
      allTabs.filter(
        (id) =>
          principal?.role === 'owner' ||
          (tabPermissions[id] && can(principal, tabPermissions[id]!)),
      ),
    [principal],
  )
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<Tab>('orders')
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0]
  const readPermission = activeTab && tabPermissions[activeTab]
  const readOnly = Boolean(
    readPermission &&
    readPermission !== 'clients.read' &&
    !can(principal, readPermission.replace('.read', '.manage') as Permission),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    mounted.current = true
    setAdminRequestIdentity(null)
    return () => {
      mounted.current = false
      setAdminRequestIdentity(null)
    }
  }, [])
  useEffect(() => {
    if (!logoutIntent) return
    let active = true
    let inFlight = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (!active) return
      const newer = completeAdminLogout(logoutIntent)
      if (newer) {
        setLogoutIntent(newer)
        return
      }
      setLogoutIntent(null)
      setError('')
    }
    const revoke = async () => {
      if (inFlight) return
      clearTimeout(retryTimer)
      inFlight = true
      try {
        const headers = {
          ...(logoutIntent.accountId ? { 'X-Admin-Account-Id': logoutIntent.accountId } : {}),
          ...(logoutIntent.sessionId ? { 'X-Admin-Session-Id': logoutIntent.sessionId } : {}),
        }
        await apiRequest('/admin/logout', {
          method: 'POST',
          ...(Object.keys(headers).length ? { headers } : {}),
        })
        finish()
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          ['ADMIN_UNAUTHORIZED', 'ADMIN_ACCOUNT_CHANGED', 'ADMIN_SESSION_CHANGED'].includes(
            failure.code,
          )
        )
          finish()
        else if (active) {
          setError('Данные скрыты. Выход завершится при восстановлении связи.')
          retryTimer = setTimeout(() => void revoke(), 5000)
        }
      } finally {
        inFlight = false
      }
    }
    void revoke()
    window.addEventListener('online', revoke)
    return () => {
      active = false
      clearTimeout(retryTimer)
      window.removeEventListener('online', revoke)
    }
  }, [logoutIntent])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'drop-of-taste:admin-session-changed') {
        sessionEpoch.current++
        authenticatedRef.current = false
        setAuthenticated(false)
        setAdminRequestIdentity(null)
        setPrincipal(null)
        setSessionId(null)
        setDashboard(null)
        setChangingPassword(false)
        setPassword('')
        setCheckingSession(false)
        setLogoutIntent(readAdminLogout())
        return
      }
      if (event.key !== pendingLogoutKey) return
      const intent = parseAdminLogout(event.newValue)
      if (!intent) {
        const previous = parseAdminLogout(event.oldValue)
        setLogoutIntent((current) => (current?.id === previous?.id ? null : current))
        return
      }
      sessionEpoch.current++
      authenticatedRef.current = false
      setAuthenticated(false)
      setAdminRequestIdentity(null)
      setPrincipal(null)
      setSessionId(null)
      setChangingPassword(false)
      setDashboard(null)
      setPassword('')
      setCheckingSession(false)
      setLogoutIntent(intent)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    const expire = () => {
      if (!authenticatedRef.current) return
      sessionEpoch.current++
      authenticatedRef.current = false
      setAuthenticated(false)
      setAdminRequestIdentity(null)
      setPrincipal(null)
      setSessionId(null)
      setChangingPassword(false)
      setDashboard(null)
      setError('Сессия администратора истекла. Войдите снова.')
    }
    window.addEventListener('drop-of-taste:admin-session-expired', expire)
    return () => window.removeEventListener('drop-of-taste:admin-session-expired', expire)
  }, [authenticated])
  useEffect(() => {
    if (!authenticated || !principal) return
    let active = true
    let inFlight = false
    const check = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return
      inFlight = true
      try {
        const session = await apiRequest<AdminSession>('/admin/session')
        if (
          active &&
          (session.principal.id !== principal.id ||
            Boolean(sessionId && session.sessionId && session.sessionId !== sessionId))
        )
          window.dispatchEvent(new Event('drop-of-taste:admin-session-expired'))
      } catch {
        /* apiRequest broadcasts revoked sessions; network errors retain the current screen. */
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(() => void check(), 30_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [authenticated, principal, sessionId])
  function contentSaved(content: SiteContent) {
    setDashboard((current) => (current ? { ...current, content } : current))
    publishSiteUpdate('content')
  }
  async function refresh() {
    const epoch = sessionEpoch.current
    const payload = await apiRequest<
      Omit<Dashboard, 'content'> & { content: Partial<SiteContent> }
    >('/admin/dashboard')
    const result = { ...payload, content: completeAdminContent(payload.content) }
    if (mounted.current && epoch === sessionEpoch.current && !hasPendingLogout()) {
      setDashboard(result)
      setError('')
    }
    return result
  }
  useEffect(() => {
    if (!restoreAllowed.current || hasPendingLogout()) return
    let active = true
    const epoch = sessionEpoch.current
    apiRequest<AdminSession>('/admin/session')
      .then((session) => {
        if (!active || epoch !== sessionEpoch.current) return
        setAdminRequestIdentity(session.principal.id, session.sessionId ?? null)
        setSessionId(session.sessionId ?? null)
        setPrincipal(session.principal)
        authenticatedRef.current = true
        setAuthenticated(true)
        if (session.principal.mustChangePassword) return
        return refresh().catch((failure) => {
          if (active && epoch === sessionEpoch.current) setError(errorMessage(failure))
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCheckingSession(false)
      })
    return () => {
      active = false
    }
  }, [])
  async function login(event: FormEvent) {
    event.preventDefault()
    if (busy || logoutPending || hasPendingLogout()) return
    const epoch = sessionEpoch.current
    setBusy(true)
    setError('')
    try {
      const session = await apiRequest<AdminSession>('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password, ...(staffLogin ? { login: loginName } : {}) }),
      })
      if (!mounted.current || epoch !== sessionEpoch.current || hasPendingLogout()) return
      setPassword('')
      setAdminRequestIdentity(session.principal.id, session.sessionId ?? null)
      setSessionId(session.sessionId ?? null)
      setPrincipal(session.principal)
      authenticatedRef.current = true
      setAuthenticated(true)
      try {
        localStorage.setItem('drop-of-taste:admin-session-changed', crypto.randomUUID())
      } catch {
        /* storage can be unavailable */
      }
      if (!session.principal.mustChangePassword) await refresh()
    } catch (failure) {
      if (mounted.current && epoch === sessionEpoch.current) setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  function logout() {
    if (busy) return
    sessionEpoch.current++
    const intent = { id: crypto.randomUUID(), accountId: principal?.id ?? null, sessionId }
    persistAdminLogout(intent)
    authenticatedRef.current = false
    setAuthenticated(false)
    setAdminRequestIdentity(null)
    setPrincipal(null)
    setSessionId(null)
    setChangingPassword(false)
    setDashboard(null)
    setPassword('')
    setCheckingSession(false)
    setLogoutIntent(intent)
    setError('Завершаем выход…')
  }
  if (checkingSession)
    return (
      <main className={styles.login}>
        <LoadingState label="Проверяем доступ к панели…" />
      </main>
    )
  if (!authenticated)
    return (
      <main className={styles.login}>
        <div className={styles.loginCard}>
          <Link to="/">← На сайт</Link>
          <h1>{staffLogin ? 'Кабинет сотрудника' : 'Кабинет владельца'}</h1>
          <p>
            {staffLogin
              ? 'Введите логин и пароль, выданные владельцем.'
              : 'Введите пароль владельца.'}
          </p>
          {staffLogin && (
            <p>Если забыли пароль или временный пароль истёк, обратитесь к владельцу.</p>
          )}
          <form onSubmit={(event) => void login(event)}>
            {staffLogin && (
              <label className={styles.field}>
                <span>Логин</span>
                <input
                  required
                  minLength={3}
                  maxLength={64}
                  autoComplete="username"
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                />
              </label>
            )}
            <label className={styles.field}>
              <span>Пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy || logoutPending}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    )
  return (
    <main className={styles.root}>
      <div className={styles.top}>
        <div>
          <p className={styles.eyebrow}>УПРАВЛЕНИЕ САЙТОМ</p>
          <h1>{principal?.role === 'owner' ? 'Кабинет владельца' : 'Кабинет сотрудника'}</h1>
          <p>
            {principal?.name} · {principal?.role === 'owner' ? 'Полный доступ' : 'Личный доступ'}
          </p>
          <p>Изменения появляются на сайте сразу после сохранения.</p>
        </div>
        <div className={styles.topActions}>
          <Link to="/">Открыть сайт ↗</Link>
          {principal?.role === 'employee' && !principal.mustChangePassword && (
            <button type="button" onClick={() => setChangingPassword(true)}>
              Сменить пароль
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={styles.secondary}
            onClick={() => void logout()}
          >
            Выйти
          </button>
        </div>
      </div>
      {!principal?.mustChangePassword && !changingPassword && activeTab && (
        <AdminTabs tab={activeTab} onSelect={setTab} allowed={allowedTabs} />
      )}
      <div className={styles.workspaceContent}>
        {error && dashboard && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {principal?.mustChangePassword || changingPassword ? (
          <PasswordEditor
            required={Boolean(principal?.mustChangePassword)}
            onCancel={() => setChangingPassword(false)}
            onChanged={() => {
              sessionEpoch.current++
              authenticatedRef.current = false
              setAuthenticated(false)
              setAdminRequestIdentity(null)
              setPrincipal(null)
              setSessionId(null)
              setDashboard(null)
              setChangingPassword(false)
              setError('Пароль изменён. Войдите с новым паролем.')
              try {
                localStorage.setItem('drop-of-taste:admin-session-changed', crypto.randomUUID())
              } catch {
                /* optional broadcast */
              }
            }}
          />
        ) : !activeTab ? (
          <div className={styles.editor}>
            <h2>Рабочие разделы пока недоступны</h2>
            <p>Обратитесь к владельцу для выдачи прав.</p>
          </div>
        ) : !dashboard ? (
          <div className={styles.editor}>
            {error ? (
              <>
                <p className={styles.error} role="alert">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void refresh().catch((failure) => setError(errorMessage(failure)))}
                >
                  Повторить загрузку
                </button>
              </>
            ) : (
              <LoadingState label="Загружаем панель администратора…" />
            )}
          </div>
        ) : (
          <div key={activeTab}>
            {readOnly && (
              <p className={styles.readOnly} role="status">
                Только просмотр. Право редактирования выдаёт владелец.
              </p>
            )}
            <fieldset
              className={styles.accessFieldset}
              disabled={readOnly && !['orders', 'products', 'codes'].includes(activeTab)}
            >
              {activeTab === 'orders' ? (
                <OrdersEditor canManage={can(principal, 'orders.manage')} />
              ) : activeTab === 'clients' ? (
                <ClientsEditor />
              ) : activeTab === 'content' ? (
                <ContentEditor initial={dashboard.content} onSaved={contentSaved} />
              ) : activeTab === 'promotions' ? (
                <ContentEditor
                  initial={dashboard.content}
                  onSaved={contentSaved}
                  section="promotions"
                />
              ) : activeTab === 'codes' ? (
                <BonusCodesEditor canManage={can(principal, 'codes.manage')} />
              ) : activeTab === 'categories' ? (
                <CategoriesEditor data={dashboard} refresh={refresh} />
              ) : activeTab === 'products' ? (
                <ProductsEditor
                  data={dashboard}
                  refresh={refresh}
                  canManage={can(principal, 'catalog.manage')}
                />
              ) : activeTab === 'legal' ? (
                <LegalEditor initial={dashboard.content} onSaved={contentSaved} />
              ) : activeTab === 'employees' ? (
                <EmployeesEditor />
              ) : activeTab === 'logs' ? (
                <LogsEditor />
              ) : (
                <IikoEditor configured={dashboard.iikoConfigured} refresh={refresh} />
              )}
            </fieldset>
          </div>
        )}
      </div>
    </main>
  )
}
