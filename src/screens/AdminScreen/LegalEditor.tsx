import { useState, type FormEvent } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import styles from './AdminScreen.module.css'
import type { SiteContent } from '../../../shared/site-content'
import { completeAdminContent, changedContentFields, errorMessage } from './adminUtils'
import { TextField } from './AdminFields'

export function LegalEditor({
  initial,
  onSaved,
}: {
  initial: SiteContent
  onSaved: (content: SiteContent) => void
}) {
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (variant: 'privacy' | 'consent', page: SiteContent['legal']['privacy']) =>
    setContent((old) => ({ ...old, legal: { ...old.legal, [variant]: page } }))
  async function save(event: FormEvent) {
    event.preventDefault()
    const changes = changedContentFields(
      content,
      saved,
      (key) => key === 'legal' || key === 'legalRevision',
    )
    if (Object.keys(changes).length === 0) {
      setMessage('Изменений нет')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest<{ content: Partial<SiteContent> }>('/admin/content', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      const updated = completeAdminContent(result.content, saved)
      setSaved(updated)
      setContent((current) => ({
        ...updated,
        ...changedContentFields(current, content, () => true),
      }))
      setMessage('Документы сохранены и обновлены на сайте')
      onSaved(updated)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.editor} onSubmit={(event) => void save(event)}>
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить документы'}
        </button>
        <span role="status">{message}</span>
      </div>
      <h2>Юридические страницы</h2>
      <p>
        Изменяя текст согласия, задайте новую редакцию. Эта редакция сохраняется при следующем входе
        посетителя.
      </p>
      <TextField
        label="Редакция согласия (например, 2026-11-07)"
        value={content.legalRevision}
        onChange={(v) => setContent((old) => ({ ...old, legalRevision: v }))}
      />
      {(['privacy', 'consent'] as const).map((variant) => {
        const page = content.legal[variant]
        return (
          <section key={variant} className={styles.panel}>
            <h2>
              {variant === 'privacy'
                ? 'Политика конфиденциальности'
                : 'Согласие на обработку данных'}
            </h2>
            <TextField
              label="Заголовок"
              value={page.title}
              onChange={(v) => change(variant, { ...page, title: v })}
            />
            <TextField
              label="Вводный текст"
              value={page.intro}
              onChange={(v) => change(variant, { ...page, intro: v })}
              multiline
            />
            {page.sections.map(([title, body], index) => (
              <div className={styles.panel} key={index}>
                <div className={styles.row}>
                  <h3>Раздел {index + 1}</h3>
                  <button
                    className={styles.danger}
                    type="button"
                    disabled={page.sections.length === 1}
                    onClick={() =>
                      change(variant, {
                        ...page,
                        sections: page.sections.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Удалить
                  </button>
                </div>
                <TextField
                  label="Заголовок раздела"
                  value={title}
                  onChange={(v) =>
                    change(variant, {
                      ...page,
                      sections: page.sections.map((old, i) => (i === index ? [v, old[1]] : old)),
                    })
                  }
                />
                <TextField
                  label="Текст раздела"
                  value={body}
                  onChange={(v) =>
                    change(variant, {
                      ...page,
                      sections: page.sections.map((old, i) => (i === index ? [old[0], v] : old)),
                    })
                  }
                  multiline
                />
              </div>
            ))}
            <button
              className={styles.secondary}
              type="button"
              disabled={page.sections.length >= 30}
              onClick={() =>
                change(variant, {
                  ...page,
                  sections: [...page.sections, ['Новый раздел', 'Текст раздела']],
                })
              }
            >
              Добавить раздел
            </button>
          </section>
        )
      })}
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить документы'}
        </button>
        <span role="status">{message}</span>
      </div>
    </form>
  )
}
