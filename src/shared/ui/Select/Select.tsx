import {
  Children,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './Select.module.css'

type OptionProps = {
  value?: string | number
  children?: ReactNode
  disabled?: boolean
  label?: string
}
type SelectProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'children' | 'onChange'
> & {
  value: string | number
  onValueChange: (value: string) => void
  children: ReactNode
}

// Option elements describe choices; only the styled listbox is rendered.
export function Select({
  value,
  onValueChange,
  children,
  disabled,
  className,
  name,
  ...props
}: SelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child) || child.type !== 'option') return []
    const label = child.props.label ?? Children.toArray(child.props.children).join('')
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }]
  })
  const optionsKey = JSON.stringify(options)
  const available = options.some((option) => !option.disabled)
  const selected = options.findIndex((option) => option.value === String(value))
  const [open, setOpen] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  // Temporary disabling must dismiss the menu, not reopen it when saving finishes.
  if ((disabled || !available) && open) setOpen(false)
  const expanded = open && !disabled
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const initialFocus = useRef(0)
  const typeahead = useRef({ text: '', at: 0 })
  const listId = useId()
  const triggerId = useId()

  function close(restoreFocus = false) {
    setOpen(false)
    typeahead.current = { text: '', at: 0 }
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }
  function show(index = selected) {
    if (triggerRef.current?.matches(':disabled') || !available) return
    initialFocus.current =
      index >= 0 && !options[index]?.disabled
        ? index
        : options.findIndex((option) => !option.disabled)
    setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body)
    setOpen(true)
  }
  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled || triggerRef.current?.matches(':disabled')) return
    close(true)
    if (option.value !== String(value)) onValueChange(option.value)
  }

  useLayoutEffect(() => {
    if (!expanded) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const below = Math.max(0, top + height - rect.bottom - 14)
      const above = Math.max(0, rect.top - top - 14)
      const upwards = below < Math.min(menu.scrollHeight, 280) && above > below
      const menuWidth = Math.min(Math.max(rect.width, 190), width - 16)
      menu.style.width = `${menuWidth}px`
      menu.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - menuWidth - 8))}px`
      menu.style.maxHeight = `${Math.min(320, upwards ? above : below)}px`
      menu.style.top = `${upwards ? Math.max(top + 8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6}px`
    }
    // The top layer also keeps choices above dialogs and scrollable panels.
    const font = window.getComputedStyle(trigger)
    menu.style.fontFamily = font.fontFamily
    menu.style.fontSize = font.fontSize
    menu.showPopover?.()
    position()
    const initial = optionRefs.current[initialFocus.current]
    const focusTarget =
      initial && !initial.disabled
        ? initial
        : menu.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
    focusTarget?.focus({ preventScroll: true })
    focusTarget?.scrollIntoView?.({ block: 'nearest' })
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!trigger.contains(target) && !menu.contains(target)) close()
    }
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node
      if (!trigger.contains(target) && !menu.contains(target)) close()
    }
    const reposition = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) position()
    }
    const disabledObserver = new MutationObserver(() => close())
    disabledObserver.observe(trigger, { attributes: true, attributeFilter: ['disabled'] })
    for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'FIELDSET') {
        disabledObserver.observe(parent, { attributes: true, attributeFilter: ['disabled'] })
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', reposition, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    observer?.observe(trigger)
    return () => {
      if (menu.isConnected) menu.hidePopover?.()
      observer?.disconnect()
      disabledObserver.disconnect()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', reposition, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [expanded, optionsKey])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab' && expanded) {
      // Restore the trigger before the browser advances to the next form field.
      close(true)
      return
    }
    const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]))
    const current = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement)
    const at = enabled.indexOf(current)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length]
    else if (event.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') next = enabled[0]
    else if (event.key === 'End') next = enabled[enabled.length - 1]
    else if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = event.timeStamp
      const previous = now - typeahead.current.at < 700 ? typeahead.current.text : ''
      const search = `${previous}${event.key}`.toLocaleLowerCase('ru-RU')
      typeahead.current = { text: search, at: now }
      const prefix = [...search].every((char) => char === search.charAt(0))
        ? search.charAt(0)
        : search
      next = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)].find((index) =>
        options[index]?.label.toLocaleLowerCase('ru-RU').startsWith(prefix),
      )
    } else return
    event.preventDefault()
    if (!expanded) show(event.key.startsWith('Arrow') ? selected : next)
    else if (next !== undefined) {
      optionRefs.current[next]?.focus({ preventScroll: true })
      optionRefs.current[next]?.scrollIntoView?.({ block: 'nearest' })
    }
  }

  return (
    <span className={styles.select}>
      <button
        {...props}
        id={props.id ?? triggerId}
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`${styles.trigger} ${className ?? ''}`}
        disabled={disabled || !available}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        onKeyDown={onKeyDown}
        onClick={() => (expanded ? close() : show())}
      >
        <span className={styles.value}>{options[selected]?.label ?? 'Выберите…'}</span>
        <span className={styles.arrow} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      {expanded &&
        portalTarget &&
        createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-label'] ? undefined : (props.id ?? triggerId)}
            className={styles.options}
            popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined}
            onKeyDown={onKeyDown}
          >
            {options.map((option, index) => (
              <li key={`${option.value}-${index}`} role="none">
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected === index}
                  disabled={option.disabled}
                  className={styles.option}
                  onClick={() => choose(index)}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>,
          portalTarget,
        )}
    </span>
  )
}
