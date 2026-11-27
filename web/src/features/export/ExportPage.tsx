import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/apiError'
import { currentUserId } from '../../api/session'
import { Button } from '../../components/Button'
import DateField from '../../components/DateField'
import ErrorMessage from '../../components/ErrorMessage'
import Field from '../../components/Field'
import RetryMessage from '../../components/RetryMessage'
import { SubScreen } from '../../components/Screen'
import SegmentedChoice from '../../components/SegmentedChoice'
import { useToast } from '../../components/ToastContext'
import { today } from '../../lib/calendarDate'
import { failureTextOf, isConnectionLost, type ActionWords } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import type { ExportFormat, ExportResult } from './exportFile'
import {
  checkRange,
  defaultRange,
  END_BEFORE_START,
  END_REQUIRED,
  outOfRangeText,
  START_REQUIRED,
  wholeRange,
  type ExportRange,
  type RangeErrors,
} from './exportRange'
import { useExport } from './useExport'
import styles from './Export.module.css'

type Period = 'all' | 'range'

const periodOptions = [
  { value: 'all', label: '전체' },
  { value: 'range', label: '기간 정하기' },
] as const

const formatOptions = [
  { value: 'xlsx', label: '엑셀(xlsx)' },
  { value: 'csv', label: 'CSV' },
] as const

const EXPORT: ActionWords = { failed: '내보내지', able: '내보낼' }

const SAVED = '파일을 내려받았어요'
const NONE_IN_LEDGER = '이 장부에는 아직 내보낼 거래가 없어요'
const NONE_IN_PERIOD = '이 기간에는 내보낼 거래가 없어요. 기간을 바꿔 주세요.'
const LEDGER_GONE = '이 장부를 볼 수 없어요.'

/** 버튼 바로 위의 한 줄. 한 버튼 위에는 한 줄만 둔다(00-common 4.3) */
type Outcome =
  | { kind: 'empty'; period: Period }
  | { kind: 'gone' }
  | { kind: 'failed'; count: number; text: string; lost: boolean }

/**
 * K-01 엑셀·CSV 내보내기(F-701, P-228). 1단계에는 장부가 하나라 장부 고르기 대신 이름만 보이고(기기에 있어 뼈대가 없다),
 * 전환 줄(3단계)도 없다. "내보내기"는 확인 창 없이 서버가 만든 파일을 받아 저장하고 이 화면에 머문다.
 * 연결이 없으면 (1)~(4)는 고를 수 있고 "내보내기"만 문구 없이 비활성이다(띠가 알린다, R1).
 */
export default function ExportPage() {
  const ledger = useCurrentLedger()
  const showToast = useToast()
  const exporting = useExport()
  const online = useConnection() === 'online'
  const [period, setPeriod] = useState<Period>('all')
  // 기본값은 연 때의 기기 오늘로 정하고, 연 채로 날이 바뀌어도 고른 값은 그대로 둔다
  const [range, setRange] = useState<ExportRange>(() => defaultRange(today()))
  const [errors, setErrors] = useState<RangeErrors>({})
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [outcome, setOutcome] = useState<Outcome>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5)
  const [sender, setSender] = useState<'export' | 'retry'>('export')
  const startField = useRef<HTMLButtonElement>(null)
  const endField = useRef<HTMLButtonElement>(null)

  const busy = exporting.isPending
  const showRange = period === 'range'

  function changePeriod(next: Period) {
    setPeriod(next)
    if (outcome?.kind === 'empty') setOutcome(undefined)
  }

  // 고를 때마다 다시 검사한다. 날짜를 고르면 칸을 벗어난 것이다(00-common 4.4)
  function changeDate(field: keyof ExportRange, date: string) {
    const next = { ...range, [field]: date }
    setRange(next)
    setErrors(checkRange(next))
    if (outcome?.kind === 'empty') setOutcome(undefined)
  }

  function focusFirst(found: RangeErrors) {
    ;(found.from ? startField : endField).current?.focus()
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    start('export')
  }

  function start(from: 'export' | 'retry') {
    if (busy || !online) return
    const asked = showRange ? range : wholeRange(today())
    if (showRange) {
      const found = checkRange(range)
      setErrors(found)
      if (found.from || found.to) {
        focusFirst(found)
        return
      }
    }
    // 앞 결과의 안내는 지우고 실패 문구는 다시 보내는 동안에도 남긴다(RetryMessage)
    if (outcome?.kind !== 'failed') setOutcome(undefined)
    setSender(from)
    const asPeriod = period
    exporting.mutate(
      { request: { format, ...asked }, user: currentUserId() },
      { onSuccess: (result) => finish(result, asPeriod), onError: showFailure },
    )
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(result: ExportResult, asPeriod: Period) {
    if (result.kind === 'empty') {
      setOutcome({ kind: 'empty', period: asPeriod })
      return
    }
    setOutcome(undefined)
    showToast(SAVED)
  }

  function showFailure(error: Error) {
    const rejected = showRange ? rejectedFields(error, today()) : undefined
    if (rejected) {
      setErrors(rejected)
      setOutcome(undefined)
      focusFirst(rejected)
      return
    }
    if (error instanceof ApiError && error.status === 404) {
      setOutcome({ kind: 'gone' })
      return
    }
    setOutcome((last) => ({
      kind: 'failed',
      count: last?.kind === 'failed' ? last.count + 1 : 1,
      text: failureTextOf(error, EXPORT),
      lost: isConnectionLost(error),
    }))
  }

  return (
    <SubScreen title="내보내기" parent="/more">
      <form className={styles.form} noValidate onSubmit={submit}>
        <div className={styles.fields}>
          {/* (1) 1단계에는 장부가 하나라 고르기 대신 이름 글자만 둔다 */}
          <Field group label="장부">
            {() => <p className={styles.ledgerName}>{ledger.name}</p>}
          </Field>
          <Field group label="기간">
            {(group) => (
              <SegmentedChoice
                label="기간"
                options={periodOptions}
                value={period}
                onChange={changePeriod}
                readOnly={busy}
                aria-describedby={group['aria-describedby']}
              />
            )}
          </Field>
          {showRange && (
            <div className={styles.range}>
              <DateField
                ref={startField}
                label="시작일"
                value={range.from}
                onChange={(date) => changeDate('from', date)}
                readOnly={busy}
                error={errors.from}
              />
              <span className={styles.between} aria-hidden="true">
                <span className={styles.tilde}>~</span>
              </span>
              <DateField
                ref={endField}
                label="종료일"
                value={range.to}
                onChange={(date) => changeDate('to', date)}
                readOnly={busy}
                error={errors.to}
              />
            </div>
          )}
          <Field group label="형식">
            {(group) => (
              <SegmentedChoice
                label="형식"
                options={formatOptions}
                value={format}
                onChange={setFormat}
                readOnly={busy}
                aria-describedby={group['aria-describedby']}
              />
            )}
          </Field>
        </div>
        <div className={styles.bottom}>
          {outcome?.kind === 'empty' && (
            <p role="status" className={styles.notice}>
              {outcome.period === 'range' ? NONE_IN_PERIOD : NONE_IN_LEDGER}
            </p>
          )}
          {outcome?.kind === 'gone' && <ErrorMessage role="alert">{LEDGER_GONE}</ErrorMessage>}
          {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
          {outcome?.kind === 'failed' && (
            <RetryMessage
              failures={outcome.count}
              onRetry={() => start('retry')}
              busy={busy && sender === 'retry'}
              disabled={(busy && sender === 'export') || !online}
            >
              {outcome.text}
            </RetryMessage>
          )}
          <Button
            kind="primary"
            type="submit"
            busy={busy && sender === 'export'}
            disabled={(busy && sender === 'retry') || !online}
          >
            내보내기
          </Button>
        </div>
      </form>
    </SubScreen>
  )
}

/** 서버가 거부한 기간 칸(400 VALIDATION_FAILED, #57). 화면이 아는 칸과 code가 아니면 없다. */
function rejectedFields(error: Error, todayDate: string): RangeErrors | undefined {
  if (!(error instanceof ApiError) || error.status !== 400 || error.code !== 'VALIDATION_FAILED') return undefined
  const texts: Record<keyof ExportRange, Record<string, string>> = {
    from: { REQUIRED: START_REQUIRED, OUT_OF_RANGE: outOfRangeText(todayDate) },
    to: { REQUIRED: END_REQUIRED, OUT_OF_RANGE: outOfRangeText(todayDate), NOT_ALLOWED: END_BEFORE_START },
  }
  const found: RangeErrors = {}
  for (const { field, code } of error.fieldErrors) {
    if (field !== 'from' && field !== 'to') return undefined
    // 서버가 준 글자로 객체의 속성을 고르지 않는다("constructor" 같은 code)
    if (!Object.hasOwn(texts[field], code)) return undefined
    found[field] = texts[field][code]
  }
  return found.from || found.to ? found : undefined
}
