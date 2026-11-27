import { expect, test } from '@playwright/test'

// A-02 로그인. 화면설계서 05-screen-spec/01-auth-home-settings.md "A-02 로그인"
// 로그인 버튼을 누르는 흐름은 서버의 로그인 API(#12)가 생긴 뒤에 더한다.

test('로그인 화면의 칸과 버튼을 이름으로 찾을 수 있다', async ({ page }) => {
  await page.goto('/login')

  // (1) 제목, (2) 이메일, (3) 비밀번호와 보기 버튼, (4) 로그인 버튼
  await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '이메일', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '비밀번호', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '비밀번호 보기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
})

test('비밀번호 보기 버튼을 누르면 비밀번호가 보이고, 다시 누르면 가려진다', async ({ page }) => {
  await page.goto('/login')
  const password = page.getByRole('textbox', { name: '비밀번호', exact: true })
  await password.fill('look4321')
  await expect(password).toHaveAttribute('type', 'password')

  // (3) 보기 버튼: 접근성 이름 "비밀번호 보기", 누르면 "비밀번호 숨기기"
  await page.getByRole('button', { name: '비밀번호 보기' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('look4321')

  await page.getByRole('button', { name: '비밀번호 숨기기' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: '비밀번호 보기' })).toBeVisible()
})
