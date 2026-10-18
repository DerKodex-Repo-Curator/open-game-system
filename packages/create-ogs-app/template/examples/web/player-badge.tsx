import { useOgsProfile } from "@open-game-system/profile-kit/react";
import { useState } from "react";

/**
 * Who is playing. In the app, the player always has an OGS profile: a guest profile from the
 * first launch (name "Player", a random sticker), and the same profile after they sign in with
 * Apple or Google from the app's native sheet, or their existing OGS profile if they had one.
 * Your page has no sign-in UI and treats guests and signed-in players the same: key saves on
 * `profile.id` and let the badge follow the profile when it changes.
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
      <span>{profile.name}</span>
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
