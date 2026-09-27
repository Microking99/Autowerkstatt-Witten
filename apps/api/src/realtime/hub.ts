/**
 * Echtzeit-Verteiler (prozessintern). Abonnements gelten je Auftrag und werden erst nach
 * Rechteprüfung angelegt (siehe routes/realtime.ts).
 *
 * HINWEIS Betrieb: Dieser Verteiler kennt nur Verbindungen im eigenen Prozess. Laufen mehrere
 * API-Instanzen, müssen Ereignisse über PostgreSQL LISTEN/NOTIFY (oder einen anderen Bus)
 * zwischen den Instanzen verteilt werden; `publish` wäre dann der NOTIFY-Auslöser.
 */

export type RealtimeEvent =
  | { type: 'message.created'; workOrderId: string; messageId: string }
  | { type: 'work_order.status_changed'; workOrderId: string; status: string }
  | { type: 'work_order.updated'; workOrderId: string }
  | { type: 'approval.updated'; workOrderId: string; approvalRequestId: string };

/** Wer ein Ereignis erhalten darf. `staff` = nur Mitarbeiter (z. B. interne Vorgänge). */
export type RealtimeAudience = 'all' | 'staff';

export interface RealtimeSubscriber {
  userId: string;
  /** Sitzung, mit der sich die Verbindung angemeldet hat */
  sessionId?: string;
  isStaff: boolean;
  /** Darf der Abonnent Chat-Ereignisse sehen (Recht messages.customerChat bzw. Kunde)? */
  canSeeMessages: (workOrderId: string) => boolean;
  send: (event: RealtimeEvent) => void;
  /** Verbindung schließen (z. B. nach Deaktivierung des Kontos) */
  close?: (code: number, reason: string) => void;
}

export class RealtimeHub {
  private readonly byWorkOrder = new Map<string, Set<RealtimeSubscriber>>();
  /** Angemeldete Verbindungen (auch ohne Abonnement), damit sie sofort getrennt werden können */
  private readonly connections = new Set<RealtimeSubscriber>();

  register(subscriber: RealtimeSubscriber): void {
    this.connections.add(subscriber);
  }

  unregister(subscriber: RealtimeSubscriber): void {
    this.connections.delete(subscriber);
    this.unsubscribeAll(subscriber);
  }

  /**
   * Trennt sofort alle Verbindungen eines Kontos (Deaktivierung, Passwort-Reset) bzw. alle außer
   * der angegebenen Sitzung (Passwortänderung). Abonnements enden damit ebenfalls.
   */
  disconnectUser(userId: string, options: { exceptSessionId?: string } = {}): void {
    for (const sub of [...this.connections]) {
      if (sub.userId !== userId) continue;
      if (options.exceptSessionId !== undefined && sub.sessionId === options.exceptSessionId) continue;
      this.unregister(sub);
      try {
        sub.close?.(4401, 'session_ended');
      } catch {
        // Verbindung bereits geschlossen
      }
    }
  }

  subscribe(workOrderId: string, subscriber: RealtimeSubscriber): void {
    let set = this.byWorkOrder.get(workOrderId);
    if (!set) {
      set = new Set();
      this.byWorkOrder.set(workOrderId, set);
    }
    set.add(subscriber);
  }

  unsubscribe(workOrderId: string, subscriber: RealtimeSubscriber): void {
    const set = this.byWorkOrder.get(workOrderId);
    if (!set) return;
    set.delete(subscriber);
    if (set.size === 0) this.byWorkOrder.delete(workOrderId);
  }

  unsubscribeAll(subscriber: RealtimeSubscriber): void {
    for (const [id, set] of this.byWorkOrder) {
      set.delete(subscriber);
      if (set.size === 0) this.byWorkOrder.delete(id);
    }
  }

  subscriberCount(workOrderId: string): number {
    return this.byWorkOrder.get(workOrderId)?.size ?? 0;
  }

  publish(event: RealtimeEvent, audience: RealtimeAudience = 'all'): void {
    const set = this.byWorkOrder.get(event.workOrderId);
    if (!set) return;
    for (const sub of set) {
      if (audience === 'staff' && !sub.isStaff) continue;
      if (event.type === 'message.created' && !sub.canSeeMessages(event.workOrderId)) continue;
      try {
        sub.send(event);
      } catch {
        // defekte Verbindung wird beim Schließen entfernt
      }
    }
  }
}
