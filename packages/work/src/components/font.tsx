import inter from "@opencode-ai/ui/fonts/inter.woff2"
import mono from "@opencode-ai/ui/fonts/ibm-plex-mono.woff2"
import { Link, Style } from "@solidjs/meta"

/**
 * The shared ui Font component ships every nerd font. This client only renders
 * prose and a little mono, so it declares the two faces it actually uses.
 */
export function Font() {
  return (
    <>
      <Style>{`
        @font-face {
          font-family: "Inter";
          src: url("${inter}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
        }
        @font-face {
          font-family: "Inter Fallback";
          src: local("Arial");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${mono}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 400;
        }
        @font-face {
          font-family: "IBM Plex Mono Fallback";
          src: local("Courier New");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
      `}</Style>
      <Link rel="preload" href={inter} as="font" type="font/woff2" crossorigin="anonymous" />
    </>
  )
}
