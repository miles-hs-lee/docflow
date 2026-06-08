import { dispatchDirectNotification } from '@/lib/notify/dispatch';
import { createAdminClient } from '@/lib/supabase/admin';

// Best-effort webhook/Teams notifications for workspace + content lifecycle
// events (team membership, new file requests, answered questions). All scoped to
// the workspace so an owner's OTHER workspaces don't receive them. Delivery is
// the shared dispatchDirectNotification — fire-and-forget, never throws. The
// workspace name (and a removed member's email) are looked up lazily inside
// build(), so a no-subscriber event costs nothing.

type MemberEventType = 'member_invited' | 'member_joined' | 'member_removed';

export async function notifyMemberEvent(input: {
  actorId: string;
  workspaceId: string;
  eventType: MemberEventType;
  /** Known email (invite address, joiner). Omit for removals → looked up by id. */
  memberEmail?: string | null;
  /** For removals where only the id is known — email resolved lazily. */
  memberUserId?: string | null;
  actorEmail: string | null;
  createdAt: string;
}): Promise<void> {
  await dispatchDirectNotification({
    ownerId: input.actorId,
    workspaceId: input.workspaceId,
    eventType: input.eventType,
    viewerEmail: input.memberEmail ?? null,
    createdAt: input.createdAt,
    build: async () => {
      const admin = createAdminClient();
      const { data: ws } = await admin
        .from('workspaces')
        .select('name')
        .eq('id', input.workspaceId)
        .maybeSingle();
      const workspaceName = (ws as { name: string } | null)?.name ?? '워크스페이스';

      let memberEmail = input.memberEmail ?? null;
      if (!memberEmail && input.memberUserId) {
        try {
          const { data } = await admin.auth.admin.getUserById(input.memberUserId);
          memberEmail = data.user?.email ?? null;
        } catch {
          // best-effort
        }
      }

      return {
        teamsReason: `${workspaceName} · ${memberEmail ?? '멤버'}`,
        webhookEvent: {
          eventType: input.eventType,
          workspaceId: input.workspaceId,
          workspaceName,
          memberEmail,
          actorEmail: input.actorEmail,
          createdAt: input.createdAt
        }
      };
    }
  });
}

export async function notifyRequestCreated(input: {
  actorId: string;
  workspaceId: string;
  requestId: string;
  title: string;
  createdAt: string;
}): Promise<void> {
  await dispatchDirectNotification({
    ownerId: input.actorId,
    workspaceId: input.workspaceId,
    eventType: 'request_created',
    viewerEmail: null,
    createdAt: input.createdAt,
    build: () => ({
      teamsReason: input.title,
      webhookEvent: {
        eventType: 'request_created',
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        title: input.title,
        createdAt: input.createdAt
      }
    })
  });
}

export async function notifyQuestionAnswered(input: {
  actorId: string;
  workspaceId: string;
  collectionId: string;
  questionId: string;
  createdAt: string;
}): Promise<void> {
  await dispatchDirectNotification({
    ownerId: input.actorId,
    workspaceId: input.workspaceId,
    eventType: 'question_answered',
    viewerEmail: null,
    createdAt: input.createdAt,
    build: async () => {
      const admin = createAdminClient();
      const { data: room } = await admin
        .from('collections')
        .select('name')
        .eq('id', input.collectionId)
        .maybeSingle();
      const collectionName = (room as { name: string } | null)?.name ?? '데이터룸';
      return {
        teamsReason: collectionName,
        webhookEvent: {
          eventType: 'question_answered',
          workspaceId: input.workspaceId,
          collectionId: input.collectionId,
          collectionName,
          questionId: input.questionId,
          createdAt: input.createdAt
        }
      };
    }
  });
}
