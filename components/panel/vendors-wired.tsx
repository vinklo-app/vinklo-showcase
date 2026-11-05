"use client";

import { addVendorContact, removeVendorContact, updateVendorContact } from "@/lib/actions/wedding-vendors";
import {
  addBudgetItem, addBudgetPayment, removeBudgetItem, removeBudgetPayment, setBudgetPaymentPaid, setBudgetTotal, updateBudgetItem,
} from "@/lib/actions/budget";
import { VendorsBoard, type VendorActions } from "@/components/panel/vendors-board";
import { BudgetBoard, type BudgetActions } from "@/components/panel/budget-board";
import type { BudgetData } from "@/lib/planning/budget";
import type { IsoDate } from "@/lib/planning/dates";
import type { VendorCategory, VendorContact } from "@/lib/vendors/contacts";

/** Agenda de proveedores y presupuesto con las server actions reales. Nada del módulo legado de pagos. */
const VENDOR_ACTIONS: VendorActions = { add: addVendorContact, update: updateVendorContact, remove: removeVendorContact };
const BUDGET_ACTIONS: BudgetActions = {
  setTotal: setBudgetTotal,
  addItem: addBudgetItem,
  updateItem: updateBudgetItem,
  removeItem: removeBudgetItem,
  addPayment: addBudgetPayment,
  setPaid: setBudgetPaymentPaid,
  removePayment: removeBudgetPayment,
};

export function VendorsBoardLive({ initial, openNew }: { initial: VendorContact[]; openNew: VendorCategory | null }) {
  return <VendorsBoard initial={initial} actions={VENDOR_ACTIONS} openNew={openNew} />;
}

export function BudgetBoardLive({ initial, contacts, today }: { initial: BudgetData; contacts: VendorContact[]; today: IsoDate }) {
  return <BudgetBoard initial={initial} contacts={contacts} today={today} actions={BUDGET_ACTIONS} />;
}
