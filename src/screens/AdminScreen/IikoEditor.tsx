import { useState } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import type { Dashboard } from './adminTypes'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'

export function IikoEditor({
  configured,
  refresh,
}: {
  configured: boolean
  refresh: () => Promise<Dashboard>
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function sync() {
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest<{ imported: number; updated: number; skipped: number }>(
        '/admin/iiko/sync',
        {
          method: 'POST',
        },
        60_000,
      )
      publishSiteUpdate('catalog')
      await refresh()
      setMessage(
        `Готово: добавлено ${result.imported}, обновлено ${result.updated}, пропущено ${result.skipped} сложных или скрытых блюд. Витрина обновлена.`,
      )
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.editor}>
      <h2>iiko</h2>
      <p>
        iiko может передавать внешнее меню: разделы, блюда, цены и фотографии. Позиции, пропавшие из
        следующей полной выгрузки, становятся недоступными. Отдельные стоп-листы пока не
        загружаются.
      </p>
      <p>
        Статус: <strong>{configured ? 'ключи указаны на сервере' : 'ключи ещё не указаны'}</strong>
      </p>
      <p>
        Чтобы подключить, внесите в серверный файл <code>.env</code> значения{' '}
        <code>IIKO_APP_ID</code>, <code>IIKO_CLIENT_SECRET</code>, <code>IIKO_API_KEY</code>,{' '}
        <code>IIKO_ORGANIZATION_ID</code> и <code>IIKO_EXTERNAL_MENU_ID</code>. Затем перезапустите
        API.
      </p>
      <p>
        Импорт запускается вручную. Существующие карточки сохраняют тексты и фото, которые вы
        изменили в панели; цены из iiko обновляются.
      </p>
      <p>Заказы с сайта в iiko пока не отправляются.</p>
      <button type="button" disabled={!configured || busy} onClick={() => void sync()}>
        {busy ? 'Загружаем…' : 'Загрузить меню из iiko'}
      </button>
      <p role="status">{message}</p>
    </div>
  )
}
