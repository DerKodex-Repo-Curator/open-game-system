# Architectural Decision Records

Decisions are append-only. Never edit old ADRs — supersede with new ones.
Named `YYYY-MM-DD-short-description.md` and sorted chronologically.

| Date | Decision | Status |
|------|----------|--------|
| 2026-03-13 | [Consolidate to pnpm monorepo](2026-03-13-consolidate-monorepo.md) | Accepted |
| 2026-03-13 | [Split notification-kit into 3 packages](2026-03-13-split-notification-kit.md) | Accepted |
| 2026-03-13 | [Managed Expo workflow](2026-03-13-managed-expo-workflow.md) | Accepted |
| 2026-03-14 | [JWT device tokens for push notifications](2026-03-14-device-token-jwt.md) | Superseded by 2026-10-07 game push |
| 2026-03-14 | [Cast-kit must use app-bridge for state sync](2026-03-14-cast-kit-uses-app-bridge.md) | Accepted; rendering/API parts superseded 2026-10-06 |
| 2026-10-04 | [TV platforms: web launcher where the device can run it, WebRTC stream where it can't; no phone rendering, no HLS (Roku not supported)](2026-10-04-tv-platforms.md) | Accepted |
| 2026-10-04 | [The OGS game contract: one spec for game developers; games integrate through profile-kit, never cast](2026-10-04-ogs-game-contract.md) | Accepted |
| 2026-10-05 | [Several households: couches join the game's room](2026-10-05-couches-join-the-games-room.md) | Accepted |
| 2026-10-06 | [Streaming renders only on Cloud Run; the Cloudflare container is removed](2026-10-06-streaming-cloud-run-only.md) | Accepted (supersedes the rendering/API parts of 2026-03-14 cast-kit) |
| 2026-10-06 | [The launcher owns joining: join QR, web join for guests, phones follow the TV, invite card, transfer link (planned)](2026-10-06-launcher-owns-joining.md) | Accepted |
| 2026-10-06 | [TV platform coverage estimates (unverified for custom receivers)](2026-10-06-tv-platform-coverage.md) | Accepted (planning input) |
| 2026-10-07 | [Beta distribution: TestFlight + Firebase App Distribution, EAS Update, and a forced update](2026-10-07-beta-distribution.md) | Accepted |
| 2026-10-07 | [Game pushes go through OGS to the app or the game's PWA; game links open the app (planned)](2026-10-07-game-push-and-app-links.md) | Accepted (supersedes 2026-03-14 device tokens) |
| 2026-10-17 | [Browser screens are a cast device, paired through the API](2026-10-17-browser-screens.md) | Accepted |
