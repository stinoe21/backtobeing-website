import "./globals.css"
import B2BLoadingAnimationV14 from "@/components/b2b-loading-animation-v14"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="nl">
      <body>
        <B2BLoadingAnimationV14 />
        {children}
      </body>
    </html>
  )
}
