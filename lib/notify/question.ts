import { dispatchDirectNotification } from '@/lib/notify/dispatch';
import { createAdminClient } from '@/lib/supabase/admin';

export type QuestionNotification = {
  ownerId: string;
  collectionId: string;
  questionId: string;
  body: string;
  askerEmail: string | null;
  createdAt: string;
};

// Best-effort owner notification when a viewer asks a data-room question.
// Delivery is the shared dispatchDirectNotification; this shapes the payload and
// looks up the room name lazily (only when ≥1 subscription matched).
export async function notifyQuestion(input: QuestionNotification): Promise<void> {
  await dispatchDirectNotification({
    ownerId: input.ownerId,
    eventType: 'question_asked',
    viewerEmail: input.askerEmail,
    createdAt: input.createdAt,
    build: async () => {
      const admin = createAdminClient();
      const { data: room } = await admin
        .from('collections')
        .select('name')
        .eq('id', input.collectionId)
        .maybeSingle();
      const collectionName = (room as { name: string } | null)?.name ?? '데이터룸';
      // Trim the body for the card (the full text lives in the dashboard).
      const preview = input.body.length > 280 ? `${input.body.slice(0, 277)}…` : input.body;
      return {
        teamsReason: `${collectionName}: ${preview}`,
        webhookEvent: {
          eventType: 'question_asked',
          collectionId: input.collectionId,
          collectionName,
          questionId: input.questionId,
          body: input.body,
          askerEmail: input.askerEmail,
          createdAt: input.createdAt
        }
      };
    }
  });
}
