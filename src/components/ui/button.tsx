import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Spinner } from './spinner'
import type { AccentColor } from '@/lib/theme/theme'
const buttonVariants = cva('ds-button', { variants:{
 variant:{default:'ds-solid',solid:'ds-solid',classic:'ds-classic',secondary:'ds-soft',soft:'ds-soft',surface:'ds-surface',outline:'ds-outline',ghost:'ds-ghost',destructive:'ds-solid ds-destructive',link:'ds-link'},
 size:{default:'ds-size-2',xs:'ds-size-1',sm:'ds-size-1',lg:'ds-size-3','1':'ds-size-1','2':'ds-size-2','3':'ds-size-3','4':'ds-size-4',icon:'ds-icon ds-size-2','icon-xs':'ds-icon ds-size-1','icon-sm':'ds-icon ds-size-1','icon-lg':'ds-icon ds-size-3'}
 },defaultVariants:{variant:'default',size:'default'}})
type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { color?:AccentColor | (string & {}); highContrast?:boolean; loading?:boolean }
function Button({className,variant='default',size='default',color,highContrast,loading,children,disabled,...props}: ButtonProps) {
 return <ButtonPrimitive data-slot="button" {...props} disabled={disabled||loading} aria-busy={loading||undefined} data-color={color} data-high-contrast={highContrast||undefined} data-loading={loading||undefined} className={cn(buttonVariants({variant,size}),className)}>
  {loading?<span className="ds-button-hidden">{children}</span>:children}{loading&&<Spinner aria-hidden className="ds-button-spinner"/>}
 </ButtonPrimitive>
}
export { Button, buttonVariants }
export type { ButtonProps }
