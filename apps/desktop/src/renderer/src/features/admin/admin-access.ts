import { isAdminRole, isModeratorRole } from '@tds/shared'
import { selectRole, useAuth } from '../../store/auth-store'

export interface AdminAccess {
  ready: boolean
  role: string | null
  /** Reviewing and gap reading: `admin` or `moderator`. */
  isModerator: boolean
  /** Catalog, economy and badge writes are `app.is_admin()` in RLS, so editors need this. */
  isAdmin: boolean
}

export function useAdminAccess(): AdminAccess {
  const ready = useAuth((state) => state.ready)
  const role = useAuth(selectRole)
  return { ready, role, isModerator: isModeratorRole(role), isAdmin: isAdminRole(role) }
}
