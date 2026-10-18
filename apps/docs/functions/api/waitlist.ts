import { type Db, handleSignup } from "../../src/waitlist";

/** POST /api/waitlist: a developer joins the waitlist (JSON from the page, or a plain form post). */
export const onRequestPost = ({ request, env }: { request: Request; env: { WAITLIST: Db } }) =>
  handleSignup(request, env.WAITLIST);
