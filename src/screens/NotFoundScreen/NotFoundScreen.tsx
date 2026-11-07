import { Link } from 'react-router'
import { ErrorPage } from '../../shared/ui/ErrorPage/ErrorPage'
import styles from './NotFoundScreen.module.css'

/** Страница 404: любой неизвестный адрес приводит сюда вместо пустого экрана. */
export function NotFoundScreen() {
  return (
    <ErrorPage
      code="404"
      illustrationLabel="Чашка кофе, из которой выплеснулась страница"
      title="Такой страницы нет"
      message="Похоже, страницу убрали из меню, а может, она растворилась, как сахар в кофе. Проверьте адрес или вернитесь на главную."
      actions={
        <>
          <Link className={`${styles.action} ${styles.primary}`} to="/">
            На главную
          </Link>
          <button
            type="button"
            className={`${styles.action} ${styles.ghost}`}
            onClick={() => window.history.back()}
          >
            Назад
          </button>
        </>
      }
    />
  )
}
