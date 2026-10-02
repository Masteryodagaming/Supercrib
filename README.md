# SUPERCRIB — Phase 1

Phone-first Supercrib (hot-seat 2-player). Race to **241** with the **StinkHole** (240).

## Quick start

```
npm install && npm run dev
```

Other scripts: dev, test, build (see package.json).

## Phase 1 scope

- Find Match: Play online or Random AI
- Vs AI: simple legal computer opponent
- Local profile (name, avatar, Vs AI career record, friends stub) via localStorage
- Online 2-player via Firebase Realtime Database (room code + share link); no gambling, no extra house rules

## Architecture

- /src/engine — pure TypeScript (cards, scoreHand, pegging, supercrib, ai); no UI imports
- /src/profile — localStorage profile + friends helpers; Google + Email/Password Auth + RTDB cloud sync (`users/{uid}`)
- /src/multiplayer — Firebase RTDB room sync (serialize GameState, room codes, session hooks)
- /src/ui — React (Login, Home, Settings, Friends, Rules, Table, Online lobby, Show overlay, pegboard)
- /src/engine/__tests__ + /src/profile/__tests__ + /src/multiplayer/__tests__ — vitest

## Locked rules (summary)

Deal 8/7 then keep 5; crib is 5 (pone discards 2, dealer 3). Spade starter = raw show; else x2 after raw. Pegging never multiplied. His heels (Jack starter) +2 to dealer, not doubled. Zero-hand redeal; zero-crib dealer -30 (floor 0); StinkHole at 240 (escape only by last card for exact 31). Cut for deal at match start (low card deals, Ace low).



## Local profile

- Key: `supercrib.profile.v1` (friends: `supercrib.friends.v1`)
- First launch: create display name + built-in avatar or uploaded image (data URL)
- Home shows avatar, name, Vs AI W–L
- Career record updates only for completed **Vs AI** games (hot-seat does not change W/L)
- Friends: requires sign-in (Google or email; screen opens but stays locked/grayed for guests). When signed in, add by player code / email sends a **friend request** (mutual after Accept). Each signed-in user gets a short `playerCode`.

## Find Match

Home primary action opens a chooser:
- **Play online** — create/join a Firebase room (see Online multiplayer below).
- **Random AI** — same Vs AI engine (human seat 0, AI seat 1).
Standalone Vs AI / New Game / local Friends hot-seat buttons removed from home.

## Vs AI

Human is seat 0 (hand face-up). AI is seat 1 (hand face-down). AI auto-plays discard, cut when pone, and pegging.

## UX notes

- **Find Match:** Play online or Random AI.
- **Deal animation:** cards deal out sequentially; human hand(s) then auto-sort A→K (Arrange still available).
- **Crib gather:** when both have discarded, crib cards animate into a labeled pile beside the dealer.
- **Arrange:** toggle Arrange on your hand — tap two cards to swap or drag to reorder (cosmetic only).
- **Cut for deal:** before deal #1 (Find Match → Random AI), both seats cut; lowest rank deals (Ace low); ties re-cut. Later deals rotate dealer as usual.
- **Cut (starter):** tap a face-down stock card in the fan to cut the starter. When AI is pone, a ~2.3s fan → select → flip/reveal animation shows the starter (×2 / spade mute) before pegging.
- **Starter:** stays face-up on the table through pegging and show.
- **Peg pile:** human cards have a red border; opponent cards have a blue border.
- **Crib:** after gather, sits in a fixed dealer-side corner for the rest of the hand (no reflow when pegging).
- **Board:** light-wood U-track pegboard (16×15=240 scoring holes + start + finish = 242 per track; scrollable tall plank); red/blue pegs leapfrog on pegging & heels; StinkHole lock ring at 240 + finish at 241. Hole-count assert: `src/ui/__tests__/pegboardHoles.test.ts`.
- **Show:** face-up hands + starter + crib with raw/×2 breakdown.

## Bugfix notes

- **Stuck on Dealing… (Find Match → Random AI / hot-seat):** React 18 Strict Mode remounts effects once in dev. The deal (and crib-gather) effects previously set a `dealNumber` ref guard *before* starting the interval/timeout; cleanup cleared the timer, then remount early-returned → `dealAnimating` stayed true forever and the AI never discarded. Fix: `dealAnimGuard` marks complete only when the timer finishes (`src/ui/dealAnimGuard.ts`); regression tests in `src/ui/__tests__/dealAnimGuard.test.ts`.




## Accounts (Google + Email/Password Auth + cloud profile)

Optional sign-in — **guest / play-without-login still works** for Vs AI and room-code multiplayer.

### What Joshua must enable in Firebase Console

1. **Authentication → Sign-in method → Google → Enable** (and save).
2. **Authentication → Sign-in method → Email/Password → Enable** (and save).
3. **Authentication → Settings → Authorized domains** — add your hosting domain (and `localhost` for dev).
4. **Realtime Database → Rules** — keep rooms open for guest room-codes; lock `users/{uid}` to the signed-in owner. Example:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": true,
        ".write": true
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    },
    "playerCodes": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid) && newData.child('uid').val() === auth.uid"
      }
    },
    "emailIndex": {
      "$emailKey": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid) && newData.child('uid').val() === auth.uid"
      }
    },
    "friendRequests": {
      "$toUid": {
        "$fromUid": {
          ".read": "auth != null && (auth.uid == $toUid || auth.uid == $fromUid)",
          ".write": "auth != null && ((!data.exists() && auth.uid == $fromUid && newData.child('fromUid').val() == $fromUid && newData.child('status').val() == 'pending') || (data.exists() && (auth.uid == $toUid || auth.uid == $fromUid)))"
        }
      }
    },
    "friendAccepts": {
      "$toUid": {
        "$fromUid": {
          ".read": "auth != null && (auth.uid == $toUid || auth.uid == $fromUid)",
          ".write": "auth != null && ((!data.exists() && auth.uid == $fromUid && newData.child('fromUid').val() == $fromUid) || (data.exists() && (auth.uid == $toUid || auth.uid == $fromUid)))"
        }
      }
    },
    "coinInbox": {
      "$toUid": {
        "$pushId": {
          ".read": "auth != null && (auth.uid == $toUid || (data.exists() && data.child('fromUid').val() == auth.uid))",
          ".write": "auth != null && ((!data.exists() && newData.child('fromUid').val() == auth.uid && newData.child('amount').val() > 0) || (data.exists() && (auth.uid == $toUid || data.child('fromUid').val() == auth.uid)))"
        }
      }
    },
    "avatarGift": {
      "$toUid": {
        "$pushId": {
          ".read": "auth != null && (auth.uid == $toUid || (data.exists() && data.child('fromUid').val() == auth.uid))",
          ".write": "auth != null && ((!data.exists() && newData.child('fromUid').val() == auth.uid && newData.child('avatarId').isString() && newData.child('avatarId').val().length > 0) || (data.exists() && (auth.uid == $toUid || data.child('fromUid').val() == auth.uid)))"
        }
      }
    }
  }
}
```

**Friend requests (mutual):** Because `users/{uid}` is owner-only, A cannot write into B’s friends list. Instead:

1. A creates `friendRequests/{bUid}/{aUid}` = `{ fromUid, fromName, fromCode?, createdAt, status: 'pending' }` and mirrors under `users/{aUid}/outgoingRequests/{bUid}`.
2. B listens to `friendRequests/{bUid}`. On **Accept**, B writes `users/{b}/friends/{a}`, writes `friendAccepts/{aUid}/{bUid}` = `{ fromUid: b, fromName, createdAt }`, and deletes the request. On **Decline**, B deletes the request.
3. A listens to `friendAccepts/{aUid}` and on a new entry writes `users/{a}/friends/{b}`, then deletes the accept receipt (and outgoing row).

**Privacy:** `playerCodes` / `emailIndex` are exact-key lookups only (no listing of all friends). Friend lists stay under `users/{uid}/friends` (owner read/write). Paste the rules above in Firebase Console — this app cannot deploy rules for you.

**Doctor coin gifts:** Because `users/{uid}` is owner-only, the owner cannot write another player's `coins` directly. Instead Settings → Super Coins → **Gift to code** writes `coinInbox/{toUid}/{pushId}`. The recipient drains the inbox on sign-in hydrate (and when Settings opens), applies `admin_grant` via `applyCoinDelta`, deletes the inbox rows, and pushes their own profile. Paste the `coinInbox` rules above — the app cannot deploy rules.

**Exclusive avatar / skin gifts:** Gift-only avatars (e.g. **The SuperCrib Father**) and board/felt skins reuse the same inbox. The sender (or admin) writes `avatarGift/{toUid}/{pushId}` = `{ fromUid, fromName?, avatarId, avatarLabel, imageSrc?, note?, at }`. The recipient sees them under Home → Notifications → **Gifts** and taps **Claim** (not auto-granted on hydrate). Claim routes by `avatarId` prefix: `board:{id}` → `grantBoardIdOnProfile`, `felt:{id}` → `grantFeltIdOnProfile`, else `grantAvatarIdOnProfile`; then deletes the inbox row, saves locally, and `writeCloudProfile`. Examples: `avatarId: "board:cj_dumpster"` / `"felt:cj_dumpster"`. No separate `skinGift` RTDB path — production already has `avatarGift` rules. Paste the `avatarGift` rules above — the app cannot deploy rules.

Until Google / Email-Password are enabled, sign-in buttons show a clear in-app error (or popup-blocked guidance). Env `.env` keys are already used for Auth — do not delete them.

### RTDB paths

- `users/{uid}/profile` — displayName, avatar, **playerCode**, Vs AI + online W/L, settings
- `users/{uid}/friends` — map of friend id → `{ id, name, status, addedAt, uid? }` (owner only; filled on **accept**)
- `users/{uid}/outgoingRequests/{toUid}` — pending requests this user sent
- `friendRequests/{toUid}/{fromUid}` — pending inbox `{ fromUid, fromName, fromCode?, createdAt, status: 'pending' }`
- `friendAccepts/{toUid}/{fromUid}` — accept receipt so the requester can add the accepter
- `coinInbox/{toUid}/{pushId}` — Doctor Super Coin gifts `{ fromUid, fromName?, amount, note?, at, reason: 'admin_grant' }` (recipient drains on hydrate / Settings)
- `avatarGift/{toUid}/{pushId}` — Exclusive avatar + skin gifts `{ fromUid, fromName?, avatarId, avatarLabel, imageSrc?, note?, at }` (recipient Claims from Home). Skin encode: `board:{boardId}` / `felt:{feltId}` (e.g. `board:cj_dumpster`)
- `playerCodes/{code}` — `{ uid, displayName }` (O(1) lookup by code; auth read)
- `emailIndex/{normalizedEmail}` — `{ uid, displayName }` (`.` → `,` in the key; auth read)

### UI

- **Login**: **Sign in with Google**, or email **Sign in** / **Create account** (password min 6, confirm on sign-up, optional display name). Either method creates the same Supercrib cloud account (profile, friends, `playerCode`). Or **Continue as guest** for Vs AI / room codes without auth. (No Sign out on Login.)
- Home: **Sign in with Google** when guest (quick path); chip shows signed-in provider (Google vs Email). **Sign out is only in Settings → Account.**
- **Settings → Account**: provider hint (Google vs Email), name/email, **Your code: XXXXXX** (copy), sync status, Sign out. Guests can Sign in with Google or expand **Sign in with email** (create-account stays on Login). Display name / avatar Save → local + `users/{uid}/profile` when signed in.
- **Friends**: guests see a locked/grayed screen with **Sign in with Google** (no local name-add list). When signed in: **Add** by player code / email sends a **pending request**; screen shows **Incoming requests** (Accept / Decline), **Outgoing pending**, then the mutual friends list.

### How to test Dad → Joshua (mutual requests)

1. Paste the RTDB rules above (merge `friendRequests` + `friendAccepts` with existing rooms/users/playerCodes/emailIndex).
2. Both Dad and Joshua **Sign in** (Google or email) on their phones (Friends stays locked until signed in).
3. Joshua: Settings → Account → copy **Your code**.
4. Dad: Friends → paste Joshua’s code → **Add** → should see Joshua under **Outgoing pending** (not yet on Friends).
5. Joshua: Friends → **Incoming requests** → Dad → **Accept**.
6. Both: each other appears under **Friends** (mutual). Decline removes the request only.

## Online multiplayer (Firebase)

Real-time 2-player on two phones. Guest play (local display name + room code) still works without signing in. Optional Google / Email Auth syncs profile/friends. No AI in this mode.

### Firebase setup (free Spark)

1. Create a project in the Firebase console.
2. Add a Web app and copy config into `.env` from `.env.example`.
3. Enable Realtime Database.
4. For beta, allow public access under rooms/CODE (see security caveat below).

Env keys: VITE_FIREBASE_API_KEY, AUTH_DOMAIN, DATABASE_URL, PROJECT_ID, APP_ID, optional STORAGE_BUCKET.

Suggested beta DB rules: public access on `rooms` (room codes are guessable secrets — friends beta only). Prefer auth-scoped rules on `users/{uid}` once Google sign-in is enabled (see Accounts section).


### How to play online

Create room from Find Match, share the code or link, guest joins, cut for deal, then play. Seat 0 is host.

### Host for iPhones

After building, deploy dist to a static host. Both phones open the same site so room share links work in Safari.

## Tournaments (Club Night v1)

Owner-gated **Club Night Round Robin** (`club_night_rr`) for 4–10 players. Reuses the existing SuperCrib engine (TARGET 241). No Swiss/elim/payments/public self-serve hosting in v1.

**Live Watch (spectate):** On Tournament Live, **Watch** opens a full table for any RR board with a `matchRoomCode`. Hole cards stay face-down until show/count; pegging plays, starter, and pegboard scores are live. This is **UI privacy only** — RTDB still syncs full `GameState` (network readers could cheat). Spectators subscribe without claiming a seat.

### Owner env (required on MSI / deploy)

In `.env` (and Firebase Hosting build env if you deploy):

```
VITE_OWNER_USER_ID=          # optional Firebase uid (preferred)
VITE_OWNER_EMAIL=j0shwa@hotmail.com
VITE_OWNER_USERNAME=         # optional displayName match
VITE_TOURNAMENTS_PUBLIC_HOSTING=false
```

- **Owner email must match the signed-in account** (Google or email/password). Default fallback is `j0shwa@hotmail.com` if `VITE_OWNER_EMAIL` is empty.
- When `VITE_TOURNAMENTS_PUBLIC_HOSTING=false` (default), only the owner sees Create / Start / Override / Delete. All signed-in users see the real Club Night UI (browse open events, join by code, spectate live boards) — not Coming Soon.
- Flip the flag to `true` later to let any logged-in user host; owner remains admin.

### Client modules

- `src/tournament/isOwner.ts` (+ `src/lib/auth/isOwner.ts`) — `isOwner` / `requireOwner` / public-hosting gate
- `src/tournament/pairings.ts` — circle method; odd bye; no rematches
- `src/tournament/scoring.ts` — win 2 / skunk 3 (&lt;91) / double skunk 4 (&lt;61); forfeit 121–90; standings sort
- `src/tournament/scheduleMeta.ts` — rounds / boards / time estimate
- `src/tournament/tournamentApi.ts` — RTDB create / lobby / start / score / complete (owner checks in client)

Screens: `Tournaments` · `TournamentLobby` · `TournamentLive` (from Home → **Tournaments**).

### RTDB rules sketch (`tournaments/*`)

Paste into Firebase Console (merge with existing `rooms` / `users` / `playerCodes`). Owner writes cannot be fully enforced by email in RTDB rules — keep client `requireOwner` and optionally lock host writes to `auth.uid === data.hostUserId` (owner uid in `VITE_OWNER_USER_ID` for stricter rules):

```json
{
  "rules": {
    "tournaments": {
      "$id": {
        ".read": "auth != null",
        ".write": "auth != null",
        "players": {
          "$uid": {
            ".write": "auth != null && (auth.uid == $uid || root.child('tournaments').child($id).child('meta').child('hostUserId').val() == auth.uid)"
          }
        },
        "joinRequests": {
          "$uid": {
            ".write": "auth != null && (auth.uid == $uid || root.child('tournaments').child($id).child('meta').child('hostUserId').val() == auth.uid)"
          }
        }
      }
    },
    "tournamentCodes": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

Tighten `.write` on `meta` / `rounds` to host uid (and known owner uid) once `VITE_OWNER_USER_ID` is set in production.

Profile field: `users/{uid}/profile/tournamentRecord` (played, wins, top4, gamePoints, skunks, bestFinish, last*, hosted).

