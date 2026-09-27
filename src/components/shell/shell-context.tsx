"use client"
import * as React from "react"

interface ShellState { paletteOpen: boolean; setPaletteOpen: (o: boolean) => void; helpOpen: boolean; setHelpOpen: (o: boolean) => void; pwOpen: boolean; setPwOpen: (o: boolean) => void }
export const ShellCtx = React.createContext<ShellState>({ paletteOpen: false, setPaletteOpen: () => {}, helpOpen: false, setHelpOpen: () => {}, pwOpen: false, setPwOpen: () => {} })
export const useShell = () => React.useContext(ShellCtx)
