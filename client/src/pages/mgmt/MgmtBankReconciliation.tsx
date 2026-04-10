// Management sees the same bank reconciliation view as HO — read-only.
// The underlying GET endpoint is already gated to ['ho', 'mgmt'] and there
// is no mutation UI on the page, so we simply re-export the HO page.
import BankReconciliation from '../ho/BankReconciliation';

export default function MgmtBankReconciliation() {
  return <BankReconciliation />;
}
