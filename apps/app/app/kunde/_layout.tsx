import { AreaGuard } from '../../src/auth/guards';
import { CustomerShell } from '../../src/navigation/shells';

/** Kundenbereich: nur Kundenkonten; fremde Rollen landen auf ihrer eigenen Startseite. */
export default function CustomerLayout() {
  return (
    <AreaGuard area="customer">
      <CustomerShell />
    </AreaGuard>
  );
}
