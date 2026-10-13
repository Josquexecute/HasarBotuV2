import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { notificationTime } from './notification-time'

interface Props {
  icon: LucideIcon
  label: string
  plate: string
  officeNumber: string
  title: string
  timestamp?: string
  read?: boolean
  tone?: 'info' | 'warning' | 'critical'
  disabled?: boolean
  action?: ReactNode
  onOpen(): void
}

export function NotificationCard({ icon: Icon, label, plate, officeNumber, title, timestamp, read, tone = 'info', disabled, action, onOpen }: Props) {
  return <article className={`notification-item notification-card notification-card--${tone}${read === true ? ' is-read' : ''}`} role="listitem">
    <button className="notification-card__body" type="button" onClick={onOpen} disabled={disabled} aria-label={`${plate} dosyasına git`}>
      <span className="notification-card__icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="notification-card__content">
        <span className="notification-card__meta"><span>{label}</span>{timestamp && <time dateTime={timestamp} title={new Date(timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}>{notificationTime(timestamp)}</time>}</span>
        <span className="notification-card__identity"><strong>{plate}</strong><small>{officeNumber}</small>{read === false && <i className="notification-card__unread" aria-label="Okunmamış" />}</span>
        <span className="notification-card__message">{title}</span>
      </span>
      <ChevronRight className="notification-card__arrow" size={17} aria-hidden="true" />
    </button>
    {action && <div className="notification-card__action">{action}</div>}
  </article>
}
