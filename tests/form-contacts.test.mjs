/** 서류 담당자 — 중분류에 한 번 적고, 다른 칸만 따로 적는다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contactFor,
  contactInputText,
  formatContact,
  parseContactInput,
  setGroupContact,
  setItemContact,
} from '../apps/web/src/features/forms/contacts.ts';
import { editItem, moveItem, upsertTaxonomies } from '../apps/web/src/features/forms/taxonomy.ts';

const base = () => ({
  id: 'q', division: '품질관련', fileName: 'x.xlsx', conflicts: [], updatedAt: 0,
  groups: [
    { code: '100', name: '공통', items: [{ code: '101', name: '니즈', groupCode: '100' }, { code: '102', name: '리스크', groupCode: '100' }] },
    { code: '200', name: '교육', items: [{ code: '201', name: '교육계획', groupCode: '200' }] },
  ],
});

test('한 줄 입력을 부서 / 이름 / 연락처로 나눈다', () => {
  assert.deepEqual(parseContactInput('품질팀 / 홍길동 대리 / 내선 1234'), { department: '품질팀', name: '홍길동 대리', phone: '내선 1234' });
  assert.deepEqual(parseContactInput('공무팀, 김철수'), { department: '공무팀', name: '김철수', phone: '' });
  assert.equal(parseContactInput('   '), undefined, '빈 줄은 지우기');
  const c = { department: '품질팀', name: '', phone: '1234' };
  assert.equal(formatContact(c), '품질팀 · 1234', '빈 칸은 건너뛴다');
  assert.deepEqual(parseContactInput(contactInputText(c)), c, '미리 채운 글자를 그대로 두면 같은 값');
});

test('칸은 중분류 담당을 물려받고, 칸에 적으면 그것이 먼저다', () => {
  const quality = { department: '품질팀', name: '홍길동', phone: '1234' };
  const other = { department: '안전팀', name: '이영희', phone: '5678' };
  let t = setGroupContact(base(), '100', quality);

  assert.deepEqual(contactFor(t, '101'), { contact: quality, inherited: true });
  assert.equal(contactFor(t, '201'), undefined, '다른 중분류는 담당 없음');

  t = setItemContact(t, '102', other);
  assert.deepEqual(contactFor(t, '102'), { contact: other, inherited: false });
  assert.deepEqual(contactFor(t, '101'), { contact: quality, inherited: true });

  t = setItemContact(t, '102', undefined);
  assert.deepEqual(contactFor(t, '102'), { contact: quality, inherited: true }, '칸 담당을 지우면 다시 물려받는다');
  t = setGroupContact(t, '100', undefined);
  assert.equal(contactFor(t, '101'), undefined);
});

test('칸 이름을 고치거나 옮겨도 담당은 따라간다', () => {
  const who = { department: '품질팀', name: '홍길동', phone: '' };
  let t = setItemContact(base(), '101', who);
  t = editItem(t, '101', { name: '이해관계자 니즈' });
  assert.equal(contactFor(t, '101')?.contact.name, '홍길동');
  t = moveItem(t, '101', '200');
  assert.deepEqual(contactFor(t, '101'), { contact: who, inherited: false });
});

test('코드표 엑셀을 다시 올려도 적어 둔 담당은 같은 번호에 남는다', () => {
  const quality = { department: '품질팀', name: '홍길동', phone: '1234' };
  const saved = setItemContact(setGroupContact(base(), '100', quality), '201', { department: '교육팀', name: '박', phone: '' });
  const reuploaded = { ...base(), id: '', groups: [...base().groups, { code: '300', name: '새 분류', items: [] }] };

  const [merged] = upsertTaxonomies([saved], [reuploaded], () => 'new');
  assert.equal(merged.id, 'q');
  assert.equal(merged.groups.length, 3, '새 중분류는 들어온다');
  assert.deepEqual(contactFor(merged, '102'), { contact: quality, inherited: true });
  assert.equal(contactFor(merged, '201')?.contact.department, '교육팀');
});
