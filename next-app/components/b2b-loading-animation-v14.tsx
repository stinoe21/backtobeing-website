"use client"

import { useEffect, useRef, useState } from "react"
import type { AnimationItem } from "lottie-web"

const STORAGE_KEY = "b2b_preloader_seen"
const ANIMATION_PATH = "/animations/b2b_loading_animation_screen_v14.json"

export default function B2BLoadingAnimationV14() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (sessionStorage.getItem(STORAGE_KEY)) return
    setActive(true)
  }, [])

  useEffect(() => {
    if (!active) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    let cancelled = false
    let anim: AnimationItem | null = null

    void import("lottie-web").then(({ default: lottie }) => {
      if (cancelled || !containerRef.current) return

      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: false,
        autoplay: true,
        path: ANIMATION_PATH,
      })

      const finish = () => {
        try {
          sessionStorage.setItem(STORAGE_KEY, "1")
        } catch {
          /* sessionStorage can throw in private mode — ignore */
        }
        setActive(false)
      }

      anim.addEventListener("complete", finish)
      anim.addEventListener("data_failed", finish)
    })

    return () => {
      cancelled = true
      if (anim) anim.destroy()
      document.body.style.overflow = previousOverflow
    }
  }, [active])

  if (!active) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fffef1",
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "min(100%, 720px)",
          height: "min(100%, 720px)",
        }}
      />
    </div>
  )
}
