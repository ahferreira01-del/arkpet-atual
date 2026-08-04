---
name: BillingService avulso isolation
description: addCharge must create standalone invoices for avulso (point-of-sale) charges; passing isAvulso:true now does this. Without isolation, paid monthly invoices were being re-opened.
---

## Rule
Always pass `isAvulso: true` when calling `BillingService.addCharge` for POS sales that are paid immediately (paymentMethod !== 'pending'). This creates a standalone invoice instead of merging into the tutor's monthly billing cycle invoice.

**Why:** Without isolation, adding a charge to an already-paid monthly invoice reset its status to `pending`, effectively unpaying the tutor's monthly bill. Any subsequent charge on the same cycle would also inherit this re-opened state.

**How to apply:** Check every `BillingService.addCharge` call site. Only leave `isAvulso` undefined/false for charges that legitimately belong in the recurring monthly cycle (booking confirmations, recurring fees). POS cash/pix/credit_card sales must use `isAvulso: true`.
