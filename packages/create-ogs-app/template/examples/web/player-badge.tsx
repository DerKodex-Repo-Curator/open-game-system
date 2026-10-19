import { requestOgsSignIn } from "@open-game-system/profile-kit";
import { useOgsProfile } from "@open-game-system/profile-kit/react";
import { useState } from "react";

/**
 * Who is playing. In the app, the player always has an OGS profile: a guest profile from the
 * first launch (name "Player", a random sticker), and the same profile after they sign in with
 * Apple or Google from the app's native sheet, or their existing OGS profile if they had one.
 * Key saves on `profile.id` and let the badge follow the profile when it changes.
 *
 * `profile.login` says which: `"guest"` until the player signs in, then `"apple"` or `"google"`.
 * Your page has no sign-in UI of its own: a guest's "Sign in" button calls `requestOgsSignIn()`,
 * which opens the app's native sheet; the signed-in profile then arrives here by itself.
 * (`login` is absent inside the OGS app, which signs players in itself.)
 *
 * In a plain browser there is no profile (null): ask for a name, as you do today.
 *
 * Your server trusts a profile only after checking `profile.token`:
 * `verifyOgsToken(token, …)` from "@open-game-system/profile-kit/server".
 */
export function PlayerBadge() {
  const profile = useOgsProfile();
  if (profile === undefined) return null; // asking the app (at most 300 ms)
  if (profile === null) return <NameForm />;
  return (
    <div className="player">
      <img src={profile.avatar} alt="" width={40} height={40} />
      <span>{profile.login === "guest" ? "Guest" : profile.name}</span>
      {profile.login === "guest" ? (
        <button type="button" onClick={() => requestOgsSignIn()}>
          Sign in
        </button>
      ) : null}
    </div>
  );
}

function NameForm() {
  const [name, setName] = useState("");
  return (
    <form className="player" onSubmit={(e) => e.preventDefault()}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={20}
      />
    </form>
  );
}
