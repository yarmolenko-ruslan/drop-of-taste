import { Select } from '../../shared/ui/Select/Select'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, apiRequest } from '../../features/auth/api/authApi'
import {
  employeePresets,
  permissionGroups,
  type Employee,
  type Permission,
  type PermissionGroup,
} from '../../../shared/admin-access'
import type { ActivityNote } from '../../../shared/admin-activity'
import { Dialog } from '../../shared/ui/Dialog/Dialog'
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'

type Draft = { name: string; login: string; active: boolean; permissions: Permission[] }
const empty = (): Draft => ({ name: '', login: '', active: true, permissions: [] })
export function EmployeesEditor() {
  const listRequest = useRef(0)
  const mounted = useRef(true)
  const credentialEpoch = useRef<object>({})
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selected, setSelected] = useState<Employee | null>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [secret, setSecret] = useState<{
    employeeId: string
    revision: string
    login: string
    password: string
    expiresAt: string | null
    active: boolean
  } | null>(null)
  const [now, setNow] = useState(Date.now)
  const expiresAt = secret?.expiresAt ? Date.parse(secret.expiresAt) : null
  const secretExpired = expiresAt !== null && expiresAt <= now
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!credentialsOpen || expiresAt === null || !Number.isFinite(expiresAt) || expiresAt <= now)
      return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now() + 1)),
    )
    return () => clearTimeout(timer)
  }, [credentialsOpen, expiresAt, now])
  const presetName =
    employeePresets.find(
      (preset) =>
        preset.permissions.length === draft.permissions.length &&
        preset.permissions.every((permission) => draft.permissions.includes(permission)),
    )?.name ?? ''
  async function note(event: ActivityNote) {
    await apiRequest('/admin/activity', { method: 'POST', body: JSON.stringify(event) })
  }
  function setPermission(group: PermissionGroup, level: 'read' | 'manage', checked: boolean) {
    setDraft((current) => {
      const hadRead = current.permissions.includes(`${group}.read`)
      const hadManage = current.permissions.includes(`${group}.manage` as Permission)
      const read = level === 'read' ? checked : checked || hadRead
      const manage = level === 'manage' ? checked : checked && hadManage
      return {
        ...current,
        permissions: [
          ...current.permissions.filter((permission) => !permission.startsWith(`${group}.`)),
          ...(read ? [`${group}.read` as Permission] : []),
          ...(manage ? [`${group}.manage` as Permission] : []),
        ],
      }
    })
  }
  function closeCredentials() {
    credentialEpoch.current = {}
    setCredentialsOpen(false)
  }
  function discardStaleCredentials(failure: unknown) {
    if (!(failure instanceof ApiError) || failure.code !== 'EMPLOYEE_CREDENTIALS_CHANGED')
      return false
    credentialEpoch.current = {}
    setSecret(null)
    setCredentialsOpen(false)
    setMessage(errorMessage(failure))
    return true
  }
  async function showCredentials() {
    if (!mounted.current || !secret || copyBusy) return
    const epoch = credentialEpoch.current
    try {
      await note({
        type: 'employee.credentials.view',
        employeeId: secret.employeeId,
        revision: secret.revision,
      })
      if (!mounted.current || epoch !== credentialEpoch.current) return
      setNow(Date.now())
      setCopyMessage('')
      setCredentialsOpen(true)
    } catch (failure) {
      if (mounted.current && epoch === credentialEpoch.current && !discardStaleCredentials(failure))
        setMessage(errorMessage(failure))
    }
  }
  async function copyCredentials() {
    if (!mounted.current) return
    const epoch = credentialEpoch.current
    if (!secret || copyBusy) return
    if (secret.expiresAt && Date.parse(secret.expiresAt) <= Date.now()) {
      setNow(Date.now())
      setCopyMessage('Временный пароль истёк. Выдайте новый пароль.')
      return
    }
    setCopyBusy(true)
    setCopyMessage('')
    let authorized = false
    try {
      await note({
        type: 'employee.credentials.copy',
        employeeId: secret.employeeId,
        revision: secret.revision,
      })
      authorized = true
      if (!mounted.current || epoch !== credentialEpoch.current) return
      if (secret.expiresAt && Date.parse(secret.expiresAt) <= Date.now()) {
        setNow(Date.now())
        setCopyMessage('Временный пароль истёк. Выдайте новый пароль.')
        return
      }
      await navigator.clipboard.writeText(
        `Вход: ${window.location.origin}/staff\nЛогин: ${secret.login}\nВременный пароль: ${secret.password}\n${secret.expiresAt ? `Пароль действует до ${new Date(secret.expiresAt).toLocaleString('ru-RU')}.` : 'Пароль действует 48 часов после выдачи.'} При первом входе задайте собственный пароль.${secret.active ? '' : '\nУчётная запись заблокирована. Владелец должен включить доступ.'}`,
      )
      if (mounted.current && epoch === credentialEpoch.current)
        setCopyMessage('Реквизиты скопированы')
    } catch (failure) {
      if (mounted.current && epoch === credentialEpoch.current && !discardStaleCredentials(failure))
        setCopyMessage(
          authorized
            ? 'Не удалось скопировать. Выделите и скопируйте логин и пароль вручную.'
            : errorMessage(failure),
        )
    } finally {
      if (mounted.current) setCopyBusy(false)
    }
  }
  async function load() {
    if (!mounted.current) return
    const sequence = ++listRequest.current
    setLoading(true)
    try {
      const result = await apiRequest<{ employees: Employee[] }>('/admin/employees')
      if (mounted.current && sequence === listRequest.current) setEmployees(result.employees)
    } catch (failure) {
      if (mounted.current && sequence === listRequest.current) setMessage(errorMessage(failure))
    } finally {
      if (mounted.current && sequence === listRequest.current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    let active = true
    const sequence = ++listRequest.current
    apiRequest<{ employees: Employee[] }>('/admin/employees')
      .then((result) => {
        if (active && sequence === listRequest.current) setEmployees(result.employees)
      })
      .catch((failure) => {
        if (active && sequence === listRequest.current) setMessage(errorMessage(failure))
      })
      .finally(() => {
        if (active && sequence === listRequest.current) setLoading(false)
      })
    return () => {
      active = false
      mounted.current = false
      credentialEpoch.current = {}
    }
  }, [])
  function select(employee: Employee | null) {
    credentialEpoch.current = {}
    setSelected(employee)
    setDraft(
      employee
        ? {
            name: employee.name,
            login: employee.login,
            active: employee.active,
            permissions: [...employee.permissions],
          }
        : empty(),
    )
    setConfirmReset(false)
    if (!employee || employee.id !== selected?.id || employee.revision !== selected.revision)
      setSecret(null)
    setCredentialsOpen(false)
    setCopyMessage('')
    setMessage('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!mounted.current || busy) return
    setBusy(true)
    setMessage('')
    if (!selected) {
      credentialEpoch.current = {}
      setSecret(null)
    }
    try {
      const result = await apiRequest<{
        employee: Employee
        temporaryPassword?: string
        temporaryPasswordExpiresAt?: string
      }>(selected ? `/admin/employees/${selected.id}` : '/admin/employees', {
        method: selected ? 'PATCH' : 'POST',
        body: JSON.stringify(
          selected
            ? {
                name: draft.name,
                active: draft.active,
                permissions: draft.permissions,
                revision: selected.revision,
              }
            : draft,
        ),
      })
      if (!mounted.current) return
      setSelected(result.employee)
      setDraft({ ...draft, login: result.employee.login })
      if (result.temporaryPassword) {
        credentialEpoch.current = {}
        setSecret({
          employeeId: result.employee.id,
          revision: result.employee.revision,
          login: result.employee.login,
          password: result.temporaryPassword,
          expiresAt: result.temporaryPasswordExpiresAt ?? null,
          active: result.employee.active,
        })
        setNow(Date.now())
        setCopyMessage('')
        setCredentialsOpen(true)
      } else
        setSecret((current) =>
          current?.employeeId === result.employee.id
            ? { ...current, active: result.employee.active, revision: result.employee.revision }
            : current,
        )
      setMessage(
        selected
          ? 'Сотрудник сохранён. Его прежние сессии отозваны.'
          : 'Сотрудник создан. Передайте ему реквизиты входа.',
      )
      await load()
    } catch (failure) {
      if (!mounted.current) return
      setMessage(errorMessage(failure))
      await load()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  async function reset() {
    if (!mounted.current || !selected || busy) return
    credentialEpoch.current = {}
    setBusy(true)
    setMessage('')
    setSecret(null)
    try {
      const result = await apiRequest<{
        employee: Employee
        temporaryPassword: string
        temporaryPasswordExpiresAt?: string
      }>(`/admin/employees/${selected.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ revision: selected.revision }),
      })
      if (!mounted.current) return
      setSelected(result.employee)
      setSecret({
        employeeId: result.employee.id,
        revision: result.employee.revision,
        login: result.employee.login,
        password: result.temporaryPassword,
        expiresAt: result.temporaryPasswordExpiresAt ?? null,
        active: result.employee.active,
      })
      setNow(Date.now())
      setCopyMessage('')
      setCredentialsOpen(true)
      setMessage('Пароль сброшен, прежние сессии отозваны.')
      await load()
    } catch (failure) {
      if (!mounted.current) return
      setMessage(errorMessage(failure))
      await load()
    } finally {
      if (mounted.current) setBusy(false)
      if (mounted.current) setConfirmReset(false)
    }
  }
  return (
    <div className={styles.editor}>
      <div className={styles.row}>
        <h2>Сотрудники</h2>
        <button type="button" disabled={busy} onClick={() => select(null)}>
          Новый сотрудник
        </button>
        <button type="button" disabled={busy || loading} onClick={() => void load()}>
          Обновить список
        </button>
      </div>
      <p>
        Личные кабинеты с индивидуальными правами. Управление доступом, журнал и iiko доступны
        только владельцу.
      </p>
      <p role="status" className={styles.statusMessage}>
        {loading ? 'Загружаем сотрудников…' : message}
      </p>
      {secret && credentialsOpen && (
        <Dialog
          titleId="employee-credentials-title"
          onClose={closeCredentials}
          className={styles.credentialsDialog}
        >
          <section className={styles.credentialsContent} aria-label="Реквизиты сотрудника">
            <p className={styles.eyebrow}>ДАННЫЕ ДЛЯ ВХОДА</p>
            <h2 id="employee-credentials-title">Сохраните временный пароль</h2>
            <p>Сотрудник создан или пароль обновлён. Передайте эти данные сотруднику лично.</p>
            <dl className={styles.credentialValues}>
              <dt>Адрес входа</dt>
              <dd>
                <code>{window.location.origin}/staff</code>
              </dd>
              <dt>Логин</dt>
              <dd>
                <strong>{secret.login}</strong>
              </dd>
              <dt>Временный пароль</dt>
              <dd>
                <code>{secret.password}</code>
              </dd>
            </dl>
            {secret.expiresAt ? (
              <p>
                Действует до{' '}
                <time dateTime={secret.expiresAt}>
                  {new Date(secret.expiresAt).toLocaleString('ru-RU')}
                </time>
                . При первом входе сотрудник заменит пароль на свой.
              </p>
            ) : (
              <p>
                Пароль действует 48 часов после выдачи. При первом входе сотрудник заменит его на
                свой.
              </p>
            )}
            {!secret.active && (
              <p role="alert" className={styles.error}>
                Учётная запись заблокирована. Для входа включите сотрудника в его карточке.
              </p>
            )}
            {secretExpired && (
              <p role="alert" className={styles.error}>
                Временный пароль истёк. Закройте окно и выдайте новый пароль.
              </p>
            )}
            <p>
              Данные можно снова открыть в текущей карточке, пока эта страница открыта. После ухода
              со страницы потребуется выдать новый временный пароль.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={copyBusy || secretExpired}
                onClick={() => void copyCredentials()}
              >
                {copyBusy ? 'Копируем…' : 'Скопировать данные для входа'}
              </button>
              <button type="button" className={styles.secondary} onClick={closeCredentials}>
                Реквизиты сохранены, скрыть
              </button>
            </div>
            <p role="status">{copyMessage}</p>
          </section>
        </Dialog>
      )}
      <div className={styles.employeeLayout}>
        <section aria-label="Список сотрудников">
          <label className={styles.field}>
            Поиск сотрудника
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
          </label>
          {!loading && employees.length === 0 && <p>Сотрудников пока нет.</p>}
          {employees
            .filter((item) =>
              `${item.name} ${item.login}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((item) => (
              <button
                type="button"
                className={styles.employeeItem}
                aria-pressed={selected?.id === item.id}
                key={item.id}
                disabled={busy}
                onClick={() => select(item)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.login} · {item.active ? 'Активен' : 'Заблокирован'}
                </span>
                <span>
                  {item.permissions.filter((permission) => permission.endsWith('.read')).length}{' '}
                  разделов{item.mustChangePassword ? ' · нужна смена пароля' : ''}
                </span>
              </button>
            ))}
        </section>
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={busy} className={styles.accessFieldset}>
            <legend>{selected ? `Карточка: ${selected.name}` : 'Создание сотрудника'}</legend>
            <label className={styles.field}>
              Имя сотрудника
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              Логин сотрудника
              <input
                required
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
                disabled={Boolean(selected)}
                autoComplete="off"
                value={draft.login}
                onChange={(event) => setDraft({ ...draft, login: event.target.value })}
              />
            </label>
            <p>
              Латинские буквы, цифры, точка, дефис и подчёркивание. Логин после создания не
              меняется.
            </p>
            <section className={styles.panel} aria-label="Пароль для входа">
              <h3>Пароль для входа</h3>
              {!selected ? (
                <p>
                  Пароль создаётся автоматически. После нажатия «Создать сотрудника» откроется окно
                  с логином и временным паролем.
                </p>
              ) : (
                <>
                  <p>
                    Сохранённый пароль посмотреть нельзя. Если пароль потерян или окно с реквизитами
                    закрыто после ухода со страницы, выдайте новый временный пароль.
                  </p>
                  {secret?.login === selected.login && (
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => void showCredentials()}
                    >
                      Показать данные для входа
                    </button>
                  )}
                  {!selected.active && (
                    <p>Сотрудник заблокирован. Для входа также включите его учётную запись.</p>
                  )}
                </>
              )}
              {selected && (
                <div className={styles.panel}>
                  {!confirmReset ? (
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => setConfirmReset(true)}
                    >
                      Выдать новый временный пароль
                    </button>
                  ) : (
                    <>
                      <p>
                        Старый пароль перестанет работать, все сессии будут отозваны. Выдать новый
                        временный пароль?
                      </p>
                      <div className={styles.row}>
                        <button type="button" onClick={() => void reset()}>
                          Подтвердить выдачу пароля
                        </button>
                        <button type="button" onClick={() => setConfirmReset(false)}>
                          Отмена
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
            <label className={styles.field}>
              Статус сотрудника
              <Select
                value={draft.active ? 'active' : 'disabled'}
                onValueChange={(value) => setDraft({ ...draft, active: value === 'active' })}
              >
                <option value="active">Активен</option>
                <option value="disabled">Заблокирован</option>
              </Select>
            </label>
            <label className={styles.field}>
              Шаблон прав
              <Select
                value={presetName}
                onValueChange={(value) => {
                  const preset = employeePresets.find((item) => item.name === value)
                  if (preset) setDraft({ ...draft, permissions: [...preset.permissions] })
                }}
              >
                <option value="" disabled>
                  Индивидуальные права
                </option>
                {employeePresets.map((item) => (
                  <option key={item.name}>{item.name}</option>
                ))}
              </Select>
            </label>
            <h3>Доступ к разделам</h3>
            <p>
              Отметьте нужные права. Редактирование автоматически включает просмотр. Если снять
              просмотр, редактирование тоже отключится.
            </p>
            {permissionGroups.map((group) => (
              <fieldset
                className={styles.permissionRow}
                key={group.id}
                aria-describedby={`permission-${group.id}`}
              >
                <legend>{group.label}</legend>
                <div className={styles.permissionChecks}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      aria-label={`${group.label}: просмотр`}
                      checked={draft.permissions.includes(`${group.id}.read`)}
                      onChange={(event) => setPermission(group.id, 'read', event.target.checked)}
                    />
                    Просмотр
                  </label>
                  {group.write ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        aria-label={`${group.label}: редактирование`}
                        checked={draft.permissions.includes(`${group.id}.manage` as Permission)}
                        onChange={(event) =>
                          setPermission(group.id, 'manage', event.target.checked)
                        }
                      />
                      Редактирование
                    </label>
                  ) : (
                    <span>Изменение данных не предусмотрено</span>
                  )}
                </div>
                <p id={`permission-${group.id}`}>{group.description}</p>
              </fieldset>
            ))}
            <p>
              <b>Итог:</b>{' '}
              {permissionGroups
                .filter((group) => draft.permissions.includes(`${group.id}.read`))
                .map(
                  (group) =>
                    `${group.label} (${draft.permissions.includes(`${group.id}.manage` as Permission) ? 'редактирование' : 'просмотр'})`,
                )
                .join(', ') || 'Нет доступа к рабочим разделам'}
              .
            </p>
            <p>
              Заказы и клиенты содержат персональные данные. Сайт, акции, коды и каталог могут
              влиять на стоимость новых заказов. При сохранении все текущие сессии сотрудника
              завершаются.
            </p>
            <button type="submit">
              {busy
                ? 'Сохраняем…'
                : selected
                  ? 'Сохранить сотрудника и отозвать сессии'
                  : 'Создать сотрудника'}
            </button>
          </fieldset>
        </form>
      </div>
    </div>
  )
}
