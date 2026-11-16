import "server-only"

import { insertReturning, selectWhere, type Db } from "@/src/data/db"
import type { NotificationLogRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "notification_log"

export function insertNotification(
  db: Db,
  input: {
    orderId?: string
    toEmail: string
    template: string
    status: string
    messageRef?: string
    error?: string
  }
): Promise<Result<NotificationLogRow>> {
  return insertReturning<NotificationLogRow>(db, TABLE, {
    id: newId("ntf"),
    order_id: input.orderId ?? null,
    to_email: input.toEmail,
    template: input.template,
    status: input.status,
    message_ref: input.messageRef ?? null,
    error: input.error ?? null,
  } as NotificationLogRow)
}

export function listNotificationsByOrder(
  db: Db,
  orderId: string
): Promise<Result<NotificationLogRow[]>> {
  return selectWhere<NotificationLogRow>(db, TABLE, [["order_id", orderId]], {
    orderBy: "created_at",
    ascending: false,
  })
}
