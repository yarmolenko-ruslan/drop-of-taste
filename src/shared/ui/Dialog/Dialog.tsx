import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import styles from './Dialog.module.css'

type DialogProps = {
  titleId: string
  onClose: () => void
  children: ReactNode
  className?: string
  placement?: 'center' | 'right'
}

export function Dialog({
  titleId,
  onClose,
  children,
  className,
  placement = 'center',
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) onClose()
    }
    dialog.addEventListener('click', handleBackdropClick)

    return () => {
      dialog.removeEventListener('click', handleBackdropClick)
      if (dialog.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose])

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${placement === 'right' ? styles.right : ''} ${className ?? ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.panel}>
        {children}
        <button
          ref={closeRef}
          className={styles.close}
          type="button"
          aria-label="Закрыть окно"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 5 19 19M19 5 5 19" />
          </svg>
        </button>
      </div>
    </dialog>,
    document.body,
  )
}
