import calendarBlank from '../assets/icons/phosphor/calendar-blank.svg?raw'
import caretDown from '../assets/icons/phosphor/caret-down.svg?raw'
import caretLeft from '../assets/icons/phosphor/caret-left.svg?raw'
import caretRight from '../assets/icons/phosphor/caret-right.svg?raw'
import caretUp from '../assets/icons/phosphor/caret-up.svg?raw'
import check from '../assets/icons/phosphor/check.svg?raw'
import dotsThree from '../assets/icons/phosphor/dots-three.svg?raw'
import eyeSlash from '../assets/icons/phosphor/eye-slash.svg?raw'
import eye from '../assets/icons/phosphor/eye.svg?raw'
import house from '../assets/icons/phosphor/house.svg?raw'
import info from '../assets/icons/phosphor/info.svg?raw'
import listBullets from '../assets/icons/phosphor/list-bullets.svg?raw'
import magnifyingGlass from '../assets/icons/phosphor/magnifying-glass.svg?raw'
import plus from '../assets/icons/phosphor/plus.svg?raw'
import signOut from '../assets/icons/phosphor/sign-out.svg?raw'
import tag from '../assets/icons/phosphor/tag.svg?raw'
import wallet from '../assets/icons/phosphor/wallet.svg?raw'
import warningCircle from '../assets/icons/phosphor/warning-circle.svg?raw'
import x from '../assets/icons/phosphor/x.svg?raw'
import styles from './Icon.module.css'

// Phosphor Icons Regular (phosphor-icons/core v2.0.8, MIT). 라이선스: ../assets/icons/phosphor/LICENSE
const svgs = {
  CalendarBlank: calendarBlank,
  CaretDown: caretDown,
  CaretLeft: caretLeft,
  CaretRight: caretRight,
  CaretUp: caretUp,
  Check: check,
  DotsThree: dotsThree,
  Eye: eye,
  EyeSlash: eyeSlash,
  House: house,
  Info: info,
  ListBullets: listBullets,
  MagnifyingGlass: magnifyingGlass,
  Plus: plus,
  SignOut: signOut,
  Tag: tag,
  Wallet: wallet,
  WarningCircle: warningCircle,
  X: x,
}

export type IconName = keyof typeof svgs

interface IconProps {
  name: IconName
  size: 20 | 24
  /** 아이콘 혼자 뜻을 전할 때만 준다. 없으면 장식으로 보고 화면 낭독기가 읽지 않는다. */
  label?: string
}

const sizeClasses = { 20: styles.size20, 24: styles.size24 }

// Phosphor Regular의 SVG 파일은 viewBox가 모두 같고 path만 다르다.
function pathsOf(svg: string): string[] {
  return Array.from(svg.matchAll(/ d="([^"]+)"/g), (match) => match[1])
}

export default function Icon({ name, size, label }: IconProps) {
  const accessibility = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg className={sizeClasses[size]} viewBox="0 0 256 256" fill="currentColor" {...accessibility}>
      {pathsOf(svgs[name]).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
