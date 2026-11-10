"use client"

import "./styles.css"
import * as React from 'react'
export const accentColors = ['gray','gold','bronze','brown','yellow','amber','orange','tomato','red','ruby','crimson','pink','plum','purple','violet','iris','indigo','blue','cyan','teal','jade','green','grass','lime','mint','sky'] as const
export const grayColors = ['auto','gray','mauve','slate','sage','olive','sand'] as const
export const radii = ['none','small','medium','large','full'] as const
export const scalings = ['90%','95%','100%','105%','110%'] as const
export type AccentColor = typeof accentColors[number]
export type ThemeConfig = { accentColor: AccentColor; grayColor: typeof grayColors[number]; appearance:'light'|'dark'; radius:typeof radii[number]; scaling:typeof scalings[number]; panelBackground:'solid'|'translucent' }
export const defaultTheme: ThemeConfig = { accentColor:'indigo',grayColor:'auto',appearance:'light',radius:'medium',scaling:'100%',panelBackground:'translucent' }
export function matchingGray(accent: AccentColor) {
 if (['tomato','red','ruby','crimson','pink','plum','purple','violet'].includes(accent)) return 'mauve'
 if (['iris','indigo','blue','sky','cyan'].includes(accent)) return 'slate'
 if (['teal','jade','mint','green'].includes(accent)) return 'sage'
 if (['grass','lime'].includes(accent)) return 'olive'
 return accent==='gray'?'gray':'sand'
}
export function parseTheme(value: unknown): ThemeConfig {
 const x = value && typeof value==='object' ? value as Record<string,unknown> : {}
 const options = {accentColor:accentColors,grayColor:grayColors,appearance:['light','dark'],radius:radii,scaling:scalings,panelBackground:['solid','translucent']}
 return Object.fromEntries(Object.entries(options).map(([key,values])=>[key,(values as readonly unknown[]).includes(x[key])?x[key]:defaultTheme[key as keyof ThemeConfig]])) as ThemeConfig
}
const ThemeContext = React.createContext<ThemeConfig>(defaultTheme)
const ThemeNestingContext = React.createContext(false)
const PortalContext = React.createContext<HTMLElement|null>(null)
export const useTheme = () => React.useContext(ThemeContext)
export const useThemePortal = () => React.useContext(PortalContext)
export function Theme({config=defaultTheme, children, className='', ...props}: React.ComponentProps<'div'> & {config?:ThemeConfig}) {
 const nested = React.useContext(ThemeNestingContext)
 const [portal,setPortal]=React.useState<HTMLDivElement|null>(null)
 return <ThemeNestingContext.Provider value={true}><ThemeContext.Provider value={config}><PortalContext.Provider value={portal}>
  <div {...props} className={`ds-theme ${config.appearance} ${className}`} data-root-theme={!nested} data-accent-color={config.accentColor} data-gray-color={config.grayColor==='auto'?matchingGray(config.accentColor):config.grayColor} data-radius={config.radius} data-scaling={config.scaling} data-panel-background={config.panelBackground} style={{...props.style,'--scaling':parseInt(config.scaling)/100} as React.CSSProperties}>
   {children}<div ref={setPortal} data-theme-portal="" />
  </div>
 </PortalContext.Provider></ThemeContext.Provider></ThemeNestingContext.Provider>
}
