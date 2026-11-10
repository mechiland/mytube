import { cn } from 'cn'
import type { ComponentProps, CSSProperties } from 'react'
// Eight fading leaves follow the fixed Radix Themes 3.3.0 motion specification.
function Spinner({className,scale,...props}:ComponentProps<'svg'>&{scale?:1|2|3}) {
 return <svg viewBox="0 0 16 16" fill="currentColor" data-slot="spinner" data-scale={scale} role="status" aria-label="Loading" className={cn('ds-spinner size-4',className)} {...props}>{Array.from({length:8},(_,i)=><rect key={i} x="7" y="0" width="2" height="4.8" rx="1" className="ds-spinner-leaf" style={{transform:`rotate(${45*i}deg)`,transformOrigin:'8px 8px',animationDelay:`${(i-8)*100}ms`} as CSSProperties}/>)}</svg>
}
export { Spinner }
