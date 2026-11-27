import { expect, test, type Page } from '@playwright/test'

// A-03 가입에서 서버를 부르기 전에 화면이 막는 입력값 오류.
// 화면설계서 05-screen-spec/01-auth-home-settings.md "A-03 가입" 예외 처리 표의 입력값 오류 행.
// 가입이 되는 흐름은 서버의 가입 API(#29)가 생긴 뒤에 더한다.

/** 가입 요청이 나갔는지 듣기만 한다. 요청을 막거나 대신 답하지 않는다. */
function watchSignupRequests(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/auth/signup')) sent.push(request.url())
  })
  return sent
}

test('비밀번호 확인이 다르면 가입을 보내지 않고 그 칸에 "비밀번호가 서로 달라요"를 보인다', async ({ page }) => {
  const sent = watchSignupRequests(page)
  await page.goto('/signup')

  await page.getByRole('textbox', { name: '이메일', exact: true }).fill('signup-mismatch@example.com')
  await page.getByRole('textbox', { name: '비밀번호', exact: true }).fill('mismatch1234')
  await page.getByRole('textbox', { name: '비밀번호 확인', exact: true }).fill('mismatch1235')
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('확인 다름')
  await page.getByRole('button', { name: '가입', exact: true }).click()

  // 누르면 위에서부터 첫 오류 칸으로 초점을 옮기고, 문구는 그 칸 바로 아래에 둔다
  const confirm = page.getByRole('textbox', { name: '비밀번호 확인', exact: true })
  await expect(confirm).toBeFocused()
  await expect(confirm).toHaveAccessibleDescription('비밀번호가 서로 달라요')
  await expect(page).toHaveURL('/signup')
  expect(sent).toEqual([])
})

test('표시 이름이 20자를 넘으면 가입을 보내지 않고 그 칸에 "1자부터 20자까지 쓸 수 있어요"를 보인다', async ({ page }) => {
  const sent = watchSignupRequests(page)
  await page.goto('/signup')

  await page.getByRole('textbox', { name: '이메일', exact: true }).fill('signup-long-name@example.com')
  await page.getByRole('textbox', { name: '비밀번호', exact: true }).fill('longname5678')
  await page.getByRole('textbox', { name: '비밀번호 확인', exact: true }).fill('longname5678')
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('가'.repeat(21))
  await page.getByRole('button', { name: '가입', exact: true }).click()

  const displayName = page.getByRole('textbox', { name: '표시 이름', exact: true })
  await expect(displayName).toBeFocused()
  // 설명에는 도움말과 글자 수가 앞에 함께 들어 있다
  await expect(displayName).toHaveAccessibleDescription(/1자부터 20자까지 쓸 수 있어요$/)
  await expect(page).toHaveURL('/signup')
  expect(sent).toEqual([])
})
