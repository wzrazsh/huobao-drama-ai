import { db } from '@/lib/db'
import { PlatformError } from '@/lib/platform/errors'

export interface PlatformActor {
  userId: string
  role: string
}

export type DramaAccessRole = 'owner' | 'editor' | 'viewer'

const WRITE_ROLES = new Set<DramaAccessRole>(['owner', 'editor'])

export async function requireActiveUserByEmail(email: string): Promise<PlatformActor & { email: string; name: string }> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  })

  if (!user) {
    throw new PlatformError('NOT_FOUND', `MCP user not found: ${email}`, 404)
  }
  if (!user.isActive) {
    throw new PlatformError('FORBIDDEN', `MCP user is disabled: ${email}`, 403)
  }

  return { userId: user.id, email: user.email, name: user.name, role: user.role }
}

export async function getDramaAccessRole(
  actor: PlatformActor,
  dramaId: string
): Promise<DramaAccessRole> {
  const drama = await db.drama.findUnique({
    where: { id: dramaId },
    select: { userId: true },
  })

  if (!drama) {
    throw new PlatformError('NOT_FOUND', 'Drama not found', 404)
  }

  if (actor.role === 'admin' || drama.userId === actor.userId) {
    return 'owner'
  }

  const member = await db.dramaMember.findUnique({
    where: { dramaId_userId: { dramaId, userId: actor.userId } },
    select: { role: true, status: true },
  })

  if (!member || member.status !== 'active') {
    throw new PlatformError('FORBIDDEN', 'You do not have access to this drama', 403)
  }

  return member.role as DramaAccessRole
}

export async function requireDramaAccess(
  actor: PlatformActor,
  dramaId: string,
  mode: 'read' | 'write' = 'read'
): Promise<DramaAccessRole> {
  const role = await getDramaAccessRole(actor, dramaId)
  if (mode === 'write' && !WRITE_ROLES.has(role)) {
    throw new PlatformError('FORBIDDEN', 'Editor access is required for this operation', 403)
  }
  return role
}

export function accessibleDramaWhere(actor: PlatformActor) {
  if (actor.role === 'admin') return {}
  return {
    OR: [
      { userId: actor.userId },
      {
        members: {
          some: {
            userId: actor.userId,
            status: 'active',
          },
        },
      },
    ],
  }
}
