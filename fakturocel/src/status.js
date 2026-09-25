import { paid, balance, total, today, money, dateLabel } from './model.js';
import { esc } from './escape.js';
export function statusView(d, s) {
  if (d.status === 'cancelled') return {
    className: 'cancelled',
    label: "Cancelled",
    icon: '×',
    detail: "The document is cancelled. History and original PDF remain."
  };
  if (d.status === 'draft') return {
    className: 'draft',
    label: "In progress",
    icon: '✎',
    detail: "This document is still a draft."
  };
  if (d.type === 'quote') return {
    className: 'issued',
    label: "Issued quote",
    icon: '✓',
    detail: "The quote has been issued. Payments are recorded only on the invoice."
  };
  const received = paid(d, s),
    remaining = balance(d, s),
    late = d.due && d.due < today();
  if (remaining <= 0) return {
    className: 'paid',
    label: 'Paid',
    icon: '✓',
    detail: remaining < 0 ? "Overpayment " + money(-remaining, d.currency) : "The invoice is fully paid."
  };
  if (received > 0) return {
    className: 'partial',
    label: "Partially paid",
    icon: '◐',
    overdue: late,
    detail: "Outstanding " + money(remaining, d.currency)
  };
  if (late) return {
    className: 'overdue',
    label: 'Overdue',
    icon: '!',
    detail: "It was due " + dateLabel(d.due)
  };
  return {
    className: 'issued',
    label: 'Unpaid',
    icon: '◷',
    detail: "Due " + dateLabel(d.due)
  };
}
export function statusBadge(d, s) {
  const v = statusView(d, s);
  return `<div class="status-badges"><span class="badge ${v.className}" aria-label="${esc(v.label)}"><span aria-hidden="true">${v.icon}</span> ${esc(v.label)}</span>${v.overdue ? '<span class="badge overdue">Overdue</span>' : ''}</div>`;
}
export function statusPanel(d, s) {
  const v = statusView(d, s),
    received = paid(d, s),
    remaining = balance(d, s),
    sum = total(d),
    isInvoice = d.type === 'invoice' && d.status !== 'draft';
  return `<section class="document-status ${v.className}" aria-label="Document and payment status"><div class="document-status-head"><div><span class="status-caption">${d.type === 'quote' ? "Offer status" : "Invoice status"}</span>${statusBadge(d, s)}</div><p>${esc(v.detail)}</p></div>${isInvoice ? `<div class="payment-summary"><div><span>Total</span><strong>${money(sum, d.currency)}</strong></div><div><span>Paid</span><strong>${money(received, d.currency)}</strong></div><div><span>${remaining < 0 ? "Overpayment" : "Outstanding"}</span><strong>${money(Math.abs(remaining), d.currency)}</strong></div></div><div class="payment-progress" role="progressbar" aria-label="Paid share of invoice" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sum > 0 ? Math.min(100, Math.round(received / sum * 100)) : 100}"><span style="width:${sum > 0 ? Math.min(100, Math.max(0, received / sum * 100)) : 100}%"></span></div>` : ''}</section>`;
}
