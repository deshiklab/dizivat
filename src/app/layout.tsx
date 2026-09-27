import "./globals.css"

// The <html> element lives in app/[locale]/layout.tsx so `lang` follows the active locale.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
