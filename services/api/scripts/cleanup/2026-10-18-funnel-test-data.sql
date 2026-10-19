-- Deletes the test data the stranger-funnel e2e left in production on 2026-10-18 (and nothing
-- else): the profile "Dana" (@dana), the browser guest "Grandma", their couch session 7FU3PN and
-- the three browser screens FUQVUD, RBBGTG, EP6ZRQ. Exact ids only, children before parents.
-- Run it through cleanup-funnel-test-data.sh (it counts first; --apply deletes).

-- Dana's phone: the push device row, then the profile link.
DELETE FROM devices WHERE ogs_device_id IN (SELECT device_id FROM profile_devices WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394'));
DELETE FROM profile_devices WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM profile_logins WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM profile_seen WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM instances WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM push_grants WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM push_surfaces WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM friendships WHERE profile_a IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394') OR profile_b IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM friend_requests WHERE from_profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394') OR to_profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM friend_invites WHERE profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM family_invites WHERE from_profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');

-- The couch (7FU3PN): the guest, members, presence, room, then the session.
DELETE FROM guest_profiles WHERE profile_id = '2543d34f-11c0-426d-99d6-d598e5a80394';
DELETE FROM session_members WHERE session_id = '0829e155-2007-4ce0-9049-f5386dd7d1e1' OR profile_id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
DELETE FROM session_live WHERE session_id = '0829e155-2007-4ce0-9049-f5386dd7d1e1';
DELETE FROM session_rooms WHERE session_id = '0829e155-2007-4ce0-9049-f5386dd7d1e1';
DELETE FROM couch_sessions WHERE id = '0829e155-2007-4ce0-9049-f5386dd7d1e1';

-- The browser screens (FUQVUD: a curl check; RBBGTG, EP6ZRQ: the e2e's TV pages).
DELETE FROM screens WHERE id IN ('0e83a29f-72bd-4703-b429-2d7236c51c41', 'ac2b20e9-e6ed-4368-8ab6-94072fa693a4', '8458505f-f863-4722-ab26-0073aea55f7b');

-- Last, the two profiles (frees the handle @dana).
DELETE FROM profiles WHERE id IN ('86db4991-8a59-463c-a1e2-5d8a26181c31', '2543d34f-11c0-426d-99d6-d598e5a80394');
