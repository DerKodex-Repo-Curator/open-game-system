// The fixture game's phone page: the OGS profile profile-kit sees.
import { getOgsProfileSource } from "@open-game-system/profile-kit";

const profile = getOgsProfileSource();
const show = () => {
  const p = profile.getSnapshot();
  const el = document.getElementById("profile");
  if (el && p !== undefined) el.textContent = p ? `${p.name} @${p.handle}` : "no profile";
};
profile.subscribe(show);
show();
