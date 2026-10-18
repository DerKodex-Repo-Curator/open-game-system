/**
 * The invite another family this phone came through (2026-10-18-invite-another-family.feature):
 * remembered from the game link, sent with the household's first cast (the API counts
 * funnel.first_session), then cleared.
 */
const KEY = "ogs.invite";

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createInviteAttribution(storage: Storage) {
  return {
    remember: (inviteId: string) => storage.setItem(KEY, inviteId),
    current: () => storage.getItem(KEY),
    clear: () => storage.removeItem(KEY),
  };
}
