import "./globals.css"
import B2BLoadingAnimationV16 from "@/components/b2b-loading-animation-v16"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="nl">
      <body>
        <B2BLoadingAnimationV16 />
        {children}
      </body>
    </html>
  )
}
