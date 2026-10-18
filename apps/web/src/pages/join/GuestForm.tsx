import {
  GUEST_STICKERS,
  type GuestJoined,
  joinAsGuest,
  stickerArt,
} from "@open-game-system/ogs-protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Join from this browser (spec ogs-join, "Guests from the browser"): a name and a sticker, no
 * install, no account. The app stays an option, never a requirement.
 */
export function GuestForm({
  api,
  launcher,
  code,
  onJoined,
}: {
  api: string;
  launcher: string;
  code: string;
  onJoined: (joined: GuestJoined) => void;
}) {
  const [name, setName] = useState("");
  const [sticker, setSticker] = useState<string>(GUEST_STICKERS[0]);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  return (
    <form
      data-testid="guest-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setSaid(null);
        void joinAsGuest(api, code, { name, sticker }, (url, init) => fetch(url, init)).then(
          (r) => {
            setBusy(false);
            if (r.kind === "joined") onJoined(r.joined);
            else
              setSaid(
                r.kind === "gone"
                  ? "That couch isn't on any more. Check the code on the TV."
                  : r.kind === "bad"
                    ? "Type your name (up to 30 letters)."
                    : "Couldn't reach OGS. Try again.",
              );
          },
        );
      }}
    >
      <label className="block text-left text-sm font-medium mb-1" htmlFor="guest-name">
        Your name
      </label>
      <input
        id="guest-name"
        data-testid="guest-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={30}
        autoComplete="given-name"
        placeholder="Your name"
        className="w-full text-lg rounded-lg border bg-background px-4 py-3 mb-4"
      />
      <p className="text-left text-sm font-medium mb-2">Pick a sticker</p>
      <div className="grid grid-cols-5 gap-2 mb-6" role="radiogroup" aria-label="Sticker">
        {GUEST_STICKERS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={sticker === id}
            aria-label={id}
            data-testid={`guest-sticker-${id}`}
            onClick={() => setSticker(id)}
            className={`rounded-xl p-1 border-2 ${sticker === id ? "border-primary bg-muted" : "border-transparent"}`}
          >
            <img
              src={stickerArt(launcher, id) ?? ""}
              alt=""
              className="w-full aspect-square object-contain"
            />
          </button>
        ))}
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !name.trim()}
        data-testid="guest-join"
      >
        {busy ? "Joining…" : "Join"}
      </Button>
      {said ? (
        <p className="text-sm text-destructive mt-3" data-testid="guest-said">
          {said}
        </p>
      ) : null}
    </form>
  );
}
