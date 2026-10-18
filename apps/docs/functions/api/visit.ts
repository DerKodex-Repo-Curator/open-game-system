import { type Db, handleVisit } from "../../src/waitlist";

/** POST /api/visit: the landing page counts a view with its UTM tags (sendBeacon). */
export const onRequestPost = ({ request, env }: { request: Request; env: { WAITLIST: Db } }) =>
  handleVisit(request, env.WAITLIST);
