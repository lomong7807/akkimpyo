import { useFormFields } from '../../components/useFormFields'
import {
  accountAddMessages,
  accountFields,
  newAccountValues,
  validateAccount,
  type AccountMessages,
} from './accountForm'

export type AccountForm = ReturnType<typeof useAccountForm>

/** 새 계좌의 네 칸. 오류 문구는 화면이 정한다. */
export function useAccountForm(messages: AccountMessages = accountAddMessages) {
  return useFormFields({
    fields: accountFields,
    initialValues: newAccountValues(),
    validate: (values) => validateAccount(values, messages),
  })
}
