"use client"

import * as React from "react"

/** true from the first time `open` is set, so a lazily loaded sheet stays mounted for its close animation */
export function useOnceOpen(open: boolean) {
  const [once, setOnce] = React.useState(open)
  React.useEffect(() => { if (open) setOnce(true) }, [open])
  return once || open
}
