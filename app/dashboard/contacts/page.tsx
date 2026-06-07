import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';

import { LocalDate } from '@/components/local-date';
import { requireWorkspace } from '@/lib/auth';
import { listWorkspaceContacts } from '@/lib/data';

export default async function ContactsPage() {
  const { workspace } = await requireWorkspace();
  const contacts = await listWorkspaceContacts(workspace.id, 200);

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          title="연락처"
          description="이메일을 입력하고 문서를 열람한 방문자를 한곳에 모아 봅니다. '이메일 요구'를 켠 링크에서 수집됩니다."
        />

        <Card>
          <CardHeader>
            <CardTitle>방문자 ({contacts.length})</CardTitle>
          </CardHeader>
          <CardBody>
            {contacts.length === 0 ? (
              <EmptyState
                title="아직 수집된 연락처가 없습니다"
                description="링크 정책에서 '이메일 요구'를 켜면 방문자가 입력한 이메일이 여기 모입니다."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>이메일</TableHead>
                    <TableHead nowrap>열람 문서</TableHead>
                    <TableHead nowrap>방문</TableHead>
                    <TableHead nowrap>열람</TableHead>
                    <TableHead nowrap>다운로드</TableHead>
                    <TableHead nowrap>NDA</TableHead>
                    <TableHead nowrap>최근 활동</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.viewer_email}>
                      <TableCell>{contact.viewer_email}</TableCell>
                      <TableCell nowrap>{contact.documents}</TableCell>
                      <TableCell nowrap>{contact.sessions}</TableCell>
                      <TableCell nowrap>{contact.opens}</TableCell>
                      <TableCell nowrap>{contact.downloads > 0 ? contact.downloads : '-'}</TableCell>
                      <TableCell nowrap>
                        {contact.agreed ? (
                          <Badge variant="success" tone="subtle">
                            동의
                          </Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell nowrap>
                        <LocalDate value={contact.last_seen} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
