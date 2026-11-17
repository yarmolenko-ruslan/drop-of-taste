import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { apiRequest, ApiError } from '../../features/auth/api/authApi'
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
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'

const pendingLogoutKey = 'drop-of-taste:admin-logout-pending'
function hasPendingLogout() {
  try {
    return localStorage.getItem(pendingLogoutKey) === '1'
  } catch {
    return false
  }
}
function storePendingLogout(pending: boolean) {
  try {
    if (pending) localStorage.setItem(pendingLogoutKey, '1')
    else localStorage.removeItem(pendingLogoutKey)
  } catch {
    /* В текущей вкладке данные скрываются и при недоступном storage. */
  }
}

export function AdminScreen() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(() => !hasPendingLogout())
  const [logoutPending, setLogoutPending] = useState(hasPendingLogout)
  const sessionEpoch = useRef(0)
  const mounted = useRef(true)
  const [password, setPassword] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<Tab>('orders')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!logoutPending) return
    let active = true
    let inFlight = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (!active) return
      storePendingLogout(false)
      setLogoutPending(false)
      setError('')
    }
    const revoke = async () => {
      if (inFlight) return
      clearTimeout(retryTimer)
      inFlight = true
      try {
        await apiRequest('/admin/logout', { method: 'POST' })
        finish()
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'ADMIN_UNAUTHORIZED') finish()
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
  }, [logoutPending])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== pendingLogoutKey || event.newValue !== '1') return
      sessionEpoch.current++
      setAuthenticated(false)
      setDashboard(null)
      setPassword('')
      setCheckingSession(false)
      setLogoutPending(true)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    const expire = () => {
      if (!authenticated) return
      sessionEpoch.current++
      setAuthenticated(false)
      setDashboard(null)
      setError('Сессия администратора истекла. Войдите снова.')
    }
    window.addEventListener('drop-of-taste:admin-session-expired', expire)
    return () => window.removeEventListener('drop-of-taste:admin-session-expired', expire)
  }, [authenticated])
  function contentSaved(content: SiteContent) {
    setDashboard((current) => (current ? { ...current, content } : current))
    publishSiteUpdate('content')
  }
  async function refresh() {
    const epoch = sessionEpoch.current
    const result = await apiRequest<Dashboard>('/admin/dashboard')
    if (mounted.current && epoch === sessionEpoch.current && !hasPendingLogout()) {
      setDashboard(result)
      setError('')
    }
    return result
  }
  useEffect(() => {
    if (hasPendingLogout()) return
    let active = true
    const epoch = sessionEpoch.current
    apiRequest('/admin/session')
      .then(() => {
        if (!active || epoch !== sessionEpoch.current) return
        setAuthenticated(true)
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
    if (busy || logoutPending) return
    const epoch = sessionEpoch.current
    setBusy(true)
    setError('')
    try {
      await apiRequest('/admin/login', { method: 'POST', body: JSON.stringify({ password }) })
      if (!mounted.current || epoch !== sessionEpoch.current || hasPendingLogout()) return
      setPassword('')
      setAuthenticated(true)
      await refresh()
    } catch (failure) {
      if (mounted.current && epoch === sessionEpoch.current) setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  function logout() {
    if (busy) return
    sessionEpoch.current++
    storePendingLogout(true)
    setAuthenticated(false)
    setDashboard(null)
    setPassword('')
    setCheckingSession(false)
    setLogoutPending(true)
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
          <h1>Панель администратора</h1>
          <p>Введите пароль администратора.</p>
          <form onSubmit={(event) => void login(event)}>
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
          <h1>Панель администратора</h1>
          <p>Изменения появляются на сайте сразу после сохранения.</p>
        </div>
        <div className={styles.topActions}>
          <Link to="/">Открыть сайт ↗</Link>
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
      <AdminTabs tab={tab} onSelect={setTab} />
      <div className={styles.workspaceContent}>
        {error && dashboard && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!dashboard ? (
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
          <div key={tab}>
            {tab === 'orders' ? (
              <OrdersEditor />
            ) : tab === 'clients' ? (
              <ClientsEditor />
            ) : tab === 'content' ? (
              <ContentEditor initial={dashboard.content} onSaved={contentSaved} />
            ) : tab === 'promotions' ? (
              <ContentEditor
                initial={dashboard.content}
                onSaved={contentSaved}
                section="promotions"
              />
            ) : tab === 'codes' ? (
              <BonusCodesEditor />
            ) : tab === 'categories' ? (
              <CategoriesEditor data={dashboard} refresh={refresh} />
            ) : tab === 'products' ? (
              <ProductsEditor data={dashboard} refresh={refresh} />
            ) : tab === 'legal' ? (
              <LegalEditor initial={dashboard.content} onSaved={contentSaved} />
            ) : tab === 'logs' ? (
              <LogsEditor />
            ) : (
              <IikoEditor configured={dashboard.iikoConfigured} refresh={refresh} />
            )}
          </div>
        )}
      </div>
    </main>
  )
}
