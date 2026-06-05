import { Alert, AlertDescription, Button, Textarea } from '@polaris/ui';

import { submitViewerQuestionAction } from '@/lib/actions/viewer';
import type { ViewerQuestion } from '@/lib/types';

type ViewerQuestionsProps = {
  token: string;
  questions: ViewerQuestion[];
  /** ?qa= status marker after a submit (sent / rate / empty / error). */
  status?: string | null;
};

const STATUS_MESSAGES: Record<string, { variant: 'success' | 'danger'; text: string }> = {
  sent: { variant: 'success', text: '질문이 전송되었습니다. 답변이 등록되면 여기에 표시됩니다.' },
  rate: { variant: 'danger', text: '질문을 너무 자주 보냈습니다. 잠시 후 다시 시도해주세요.' },
  empty: { variant: 'danger', text: '질문 내용을 입력해주세요.' },
  error: { variant: 'danger', text: '질문 전송에 실패했습니다. 잠시 후 다시 시도해주세요.' }
};

// Viewer-side Q&A panel for a data-room link (rendered in the viewer sidebar).
// Shows ONLY this viewer's own thread (private to asker + owner) plus an ask
// form. A server component — the form posts the submitViewerQuestionAction.
export function ViewerQuestions({ token, questions, status }: ViewerQuestionsProps) {
  const banner = status ? STATUS_MESSAGES[status] : null;

  return (
    <section className="viewer-qa">
      <h2 className="viewer-qa-title">질문 &amp; 답변</h2>
      <p className="viewer-qa-hint">문서에 대해 궁금한 점을 남기면 담당자가 답변합니다. 질문은 비공개로 처리됩니다.</p>

      {banner ? (
        <Alert variant={banner.variant}>
          <AlertDescription>{banner.text}</AlertDescription>
        </Alert>
      ) : null}

      {questions.length > 0 ? (
        <ul className="viewer-qa-thread">
          {questions.map((question) => (
            <li key={question.id} className="viewer-qa-item">
              <p className="viewer-qa-q">{question.body}</p>
              {question.answer ? (
                <p className="viewer-qa-a">{question.answer}</p>
              ) : (
                <span className="viewer-qa-pending">답변 대기 중</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <form action={submitViewerQuestionAction.bind(null, token)} className="viewer-qa-form">
        <Textarea
          name="question"
          required
          rows={3}
          maxLength={2000}
          aria-label="질문 내용"
          placeholder="질문을 입력하세요"
        />
        <Button type="submit" size="sm">
          질문 보내기
        </Button>
      </form>
    </section>
  );
}
