import { useFormFields } from '../../components/useFormFields'
import { accountFields, newAccountValues, validateAccount } from './accountForm'

export type AccountForm = ReturnType<typeof useAccountForm>

/** 새 계좌의 네 칸 */
export function useAccountForm() {
  return useFormFields({ fields: accountFields, initialValues: newAccountValues(), validate: validateAccount })
}
