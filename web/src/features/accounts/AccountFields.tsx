import { useState } from 'react'
import AmountField from '../../components/AmountField'
import DateField from '../../components/DateField'
import Field from '../../components/Field'
import SegmentedChoice from '../../components/SegmentedChoice'
import { TextField } from '../../components/TextField'
import { ACCOUNT_NAME_MAX, accountNameLength } from './accountForm'
import { accountTypes, type AccountType } from './accounts'
import { accountTypeNames } from './accountTypeNames'
import type { AccountForm } from './useAccountForm'
import styles from './AccountFields.module.css'

const typeOptions = accountTypes.map((type) => ({ value: type, label: accountTypeNames[type] }))

/** 칸의 이름, 예시, 도움말 가운데 계좌를 만드는 화면마다 다른 것 */
export interface AccountFieldTexts {
  nameLabel: string
  /** 없으면 도움말을 두지 않는다 */
  nameHelp?: string
  namePlaceholder: string
  dateHelp: string
}

/** 계좌 추가(화면설계서 G-02 (1)~(4))의 문구 */
const accountAddTexts: AccountFieldTexts = {
  nameLabel: '이름',
  nameHelp: '1~50자',
  namePlaceholder: '예: 국민은행 급여통장',
  dateHelp: '이날부터의 거래가 잔액에 들어가요',
}

interface AccountFieldsProps {
  form: AccountForm
  /** 보내는 중이라 바꿀 수 없다 */
  readOnly: boolean
  texts?: AccountFieldTexts
}

/** 새 계좌의 이름, 종류, 시작 잔액, 기준일. 금액 칸과 종류를 바꿀 때의 안내는 어느 화면에서나 같다. */
export default function AccountFields({ form, readOnly, texts = accountAddTexts }: AccountFieldsProps) {
  const { values, change, control, fieldProps, check } = form
  return (
    <>
      <TextField
        {...fieldProps('name')}
        readOnly={readOnly}
        label={texts.nameLabel}
        help={texts.nameHelp}
        placeholder={texts.namePlaceholder}
        count={{ current: accountNameLength(values.name), max: ACCOUNT_NAME_MAX }}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <TypeField form={form} readOnly={readOnly} />
      <AmountField
        {...control('openingBalance')}
        {...amountTexts(values.type)}
        readOnly={readOnly}
        onChange={(openingBalance) => change({ openingBalance })}
        onBlur={() => check('openingBalance')}
        sign={
          values.type === 'CARD'
            ? undefined
            : { negative: values.negative, onChange: (negative) => change({ negative }) }
        }
      />
      <DateField
        {...control('openingDate')}
        readOnly={readOnly}
        label="기준일"
        help={texts.dateHelp}
        onChange={(openingDate) => change({ openingDate })}
      />
    </>
  )
}

/** 카드는 갚을 금액을 양수로 받는다. */
function amountTexts(type: AccountType) {
  if (type === 'CARD') return { label: '지금 갚을 금액', help: '카드는 지금 갚을 금액을 적어요' }
  return { label: '시작 잔액', help: '마이너스 통장이면 -로 바꿔 적어요' }
}

function TypeField({ form: { values, change, control }, readOnly }: Omit<AccountFieldsProps, 'texts'>) {
  const [meaningChanged, setMeaningChanged] = useState(false)
  const { error, ...choice } = control('type')

  function changeType(type: AccountType) {
    if ((type === 'CARD') === (values.type === 'CARD')) {
      change({ type })
    } else {
      // 금액의 뜻이 바뀐다. 부호는 다시 고르게 한다
      change({ type, negative: false })
      setMeaningChanged(true)
    }
  }

  return (
    <Field group label="종류" error={error}>
      {(group) => (
        <>
          <SegmentedChoice
            {...choice}
            label="종류"
            options={typeOptions}
            onChange={changeType}
            readOnly={readOnly}
            aria-describedby={group['aria-describedby']}
          />
          <p role="status" className={styles.notice}>
            {meaningChanged && '종류를 바꾸면 금액의 뜻이 바뀌어요. 금액을 다시 확인해 주세요.'}
          </p>
        </>
      )}
    </Field>
  )
}
