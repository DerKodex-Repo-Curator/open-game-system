import qrcode from "qrcode-generator";

/** A QR code of `text` (a join link) as an image data URL (GIF, pure JS: works in a Worker too). */
export function qrDataUrl(text: string, cellSize = 8): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 2);
}
