import { requireUser } from '@/auth/workos';
import BattleClient from './BattleClient';

export default async function BattlePage() {
  // Redirects to AuthKit login if not authenticated (withAuth ensureSignedIn).
  await requireUser();
  return <BattleClient />;
}
