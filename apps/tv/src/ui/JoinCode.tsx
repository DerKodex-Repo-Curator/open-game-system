import { JOIN_BASE, joinLink } from "@open-game-system/ogs-protocol";
import { useMemo } from "react";
import { qrPath } from "./qr";

/**
 * The couch corner: how someone who isn't on the couch yet gets on (spec ogs-join). A QR a phone
 * camera opens (opengame.org/join/<code>: the app if installed, else the web join page), and the
 * code to type, for a phone that can't scan.
 */
export function JoinCode({ code }: { code: string }) {
  const qr = useMemo(() => qrPath(joinLink(JOIN_BASE, code)), [code]);
  return (
    <div className="join-code" data-testid="join-code">
      <svg
        className="join-qr"
        data-testid="join-qr"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code for opengame.org/join/${code}`}
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <div className="join-text">
        <span className="join-code-line" data-testid="join-line">
          Scan to join, or type
        </span>
        <span className="join-code-value" data-testid="join-value">
          {code}
        </span>
        <span className="join-code-where" data-testid="join-where">
          at opengame.org/join
        </span>
      </div>
    </div>
  );
}
