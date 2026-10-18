import qrcode from "qrcode-generator";

/** Quiet zone around the code, in modules (the QR spec asks for 4). */
const MARGIN = 4;

/**
 * A QR code as one SVG path of dark modules (one rect per run along a row), in a square of `size`
 * modules including the quiet zone. Error correction M: readable across a room off a TV.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${start + MARGIN} ${r + MARGIN}h${c - start}v1h${start - c}z`;
    }
  }
  return { size: n + MARGIN * 2, d };
}
