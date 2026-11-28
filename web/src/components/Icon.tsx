import styles from './Icon.module.css'

/** 아이콘 하나의 SVG 파일 글. components/icons.ts에서 이름으로 가져온다(예: `import { Plus } from './icons'`). */
export type IconSvg = string

interface IconProps {
  icon: IconSvg
  size: 20 | 24
  /** 아이콘 혼자 뜻을 전할 때만 준다. 없으면 장식으로 보고 화면 낭독기가 읽지 않는다. */
  label?: string
}

const sizeClasses = { 20: styles.size20, 24: styles.size24 }

// Phosphor Regular의 SVG 파일은 viewBox가 모두 같고 path만 다르다.
function pathsOf(svg: string): string[] {
  const paths = Array.from(svg.matchAll(/ d="([^"]+)"/g), (match) => match[1])
  // icons.ts의 아이콘이 아닌 글을 넘기면 빈 아이콘이 된다. 개발 중과 테스트에서 바로 알게 한다
  if (import.meta.env.DEV && paths.length === 0) throw new Error('Icon의 icon에는 components/icons.ts의 아이콘을 넘긴다')
  return paths
}

export default function Icon({ icon, size, label }: IconProps) {
  const accessibility = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg className={sizeClasses[size]} viewBox="0 0 256 256" fill="currentColor" {...accessibility}>
      {pathsOf(icon).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
