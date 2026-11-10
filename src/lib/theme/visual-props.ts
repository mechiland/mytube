import type { AccentColor } from './theme'
export type VisualProps = { color?:AccentColor | (string & {}); highContrast?:boolean; variant?:'classic'|'solid'|'soft'|'surface'|'outline'|'ghost'; scale?:1|2|3|4|5 }
export function visualAttrs({color,highContrast,variant,scale}:VisualProps) {
 return { 'data-color':color,'data-high-contrast':highContrast||undefined,'data-variant':variant,'data-scale':scale }
}
