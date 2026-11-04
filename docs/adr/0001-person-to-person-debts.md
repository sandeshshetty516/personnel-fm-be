# 0001. Person-to-person lending and borrowing

- Status: Accepted
- Date: 2026-11-04
- Requirements: FR-075 – FR-081, AC-13 – AC-15

## Context

Users lend money to, and borrow money from, friends and family. This is informal, interest-free and
different from the bank/EMI loans in FR-09. The cash really leaves or enters an account, but lending
is not spending and getting it back is not earning, so it must not distort income, expense or
net cash flow. Users also want to record old debts that predate their accounts in the app.

## Decision

1. **A `debts` module with its own entry history.** A `debts` document holds the person, direction
   (`LENT` / `BORROWED`), dates and running totals (`principalPaise`, `repaidPaise`,
   `writtenOffPaise`). Each change is a `debtEntries` document (`PRINCIPAL`, `REPAYMENT`,
   `WRITE_OFF`). The person is a free-text name on each debt; there is no contacts collection.
2. **Account link is optional per entry.** With an `accountId`, the entry also creates a
   transaction of a new type, `DEBT_OUT` (lend, or repay what you borrowed) or `DEBT_IN` (borrow, or
   get repaid), tagged with `debtId`. Without one, only the outstanding amount changes.
3. **`DEBT_IN` / `DEBT_OUT` count towards balances but never towards income or expense**, the same
   rule as transfers. Income/expense aggregations already filter to `INCOME`/`EXPENSE`, so they need
   no change; `DEBT_IN` joins `CREDIT_TYPES` for balances.
4. **Write-offs are expenses that do not move balances.** Writing off a lent amount creates an
   `EXPENSE` in a per-user "Bad Debt" category (created on first use) with `affectsBalance: false`.
   Only the balance aggregation reads that flag, so budgets, category breakdowns and cash flow count
   the loss while the account balance, which already fell when the money was lent, is untouched.
   Write-offs apply to `LENT` debts only.
5. **Integrity.** An entry, its transaction and the debt's totals change in one MongoDB transaction.
   The totals update is conditional (`principal − repaid − writtenOff ≥ amount`), so concurrent
   repayments cannot overshoot. Debt-linked transactions cannot be edited or deleted through
   `/transactions`; they are managed from the debt so the two never disagree.

## Consequences

- One more transaction type for the frontend to label (`DEBT_IN` / `DEBT_OUT`), and a `debtId` on
  transaction responses.
- `affectsBalance` is a general escape hatch; it is set only by write-offs today and should stay rare.
- No interest, reminders or shared contacts. Each can be added later without changing the model:
  interest as extra entries, reminders through the notifications module, contacts by adding an
  optional reference next to `personName`.
